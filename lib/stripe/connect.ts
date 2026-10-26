import type Stripe from "stripe";
import type { Organisation, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ApiErrorDetail } from "@/lib/api/errors";
import { mfaGrantDigest } from "@/lib/security/csrf";
import { MfaInputError, MfaRequiredError, mfaEnforcementMode, verifyStaffMfa } from "@/lib/security/staff-mfa";
import { manualPayoutSettings, payoutSummary, restoreStripePayoutSchedule, type PayoutSummary } from "@/lib/payouts/payouts";
import { heldMoney } from "@/lib/payouts/release";
import { logWarn } from "@/lib/ops/logger";
import { getAppUrl, getStripe, StripeConfigurationError } from "@/lib/stripe";

export type StripeConnectState =
  | "NOT_CONNECTED"
  | "PLATFORM_NOT_READY"
  | "CONNECTED_INCOMPLETE"
  | "RESTRICTED"
  | "READY"
  | "ERROR";

export const stripePlatformProfileUrl =
  "https://dashboard.stripe.com/settings/connect/platform-profile";

export type StripeConnectStatus = {
  accountId: string | null;
  connected: boolean;
  state: StripeConnectState;
  ready: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  currently_due: string[];
  eventually_due: string[];
  disabled_reason: string | null;
  // The society has finished onboarding, so Stripe can sign it in to its own Express Dashboard.
  dashboard_available: boolean;
  actionUrl?: string;
  actionRequired?: string;
  error?: string;
  // Orders still tied to this account; while any exist it cannot be disconnected.
  openObligations?: number;
  // PAY-005: what is held for events and memberships, on its way, and recent payouts.
  payouts?: PayoutSummary;
};

type ConnectOrganisation = Pick<
  Organisation,
  "id" | "name" | "slug" | "stripeAccountId"
>;

export class StripeConnectPlatformNotReadyError extends Error {
  state = "PLATFORM_NOT_READY" as const;
  actionRequired = "Complete Stripe Connect platform profile";
  actionUrl = stripePlatformProfileUrl;

  constructor(message = "Stripe platform setup incomplete") {
    super(message);
    this.name = "StripeConnectPlatformNotReadyError";
  }
}

export class OrganisationStripeConnectNotFoundError extends Error {
  constructor(message = "Organisation was not found") {
    super(message);
    this.name = "OrganisationStripeConnectNotFoundError";
  }
}

export const heldMoneyBlocksDisconnect =
  "Money from your sales is held for refunds until 2 days after each event, and 7 days after membership and merchandise sales. Disconnect once Thunderstrux has paid it to your bank.";

export class StripeDisconnectBlockedError extends Error {
  constructor(readonly count: number, message?: string) {
    super(
      message ??
        `${count} ${count === 1 ? "order is" : "orders are"} still being paid or reviewed, and ${count === 1 ? "it needs" : "they need"} this Stripe account. Try again once they finish.`
    );
    this.name = "StripeDisconnectBlockedError";
  }
}

export class StripeDisconnectUnavailableError extends Error {
  constructor() {
    super("Stripe couldn't be reached to disconnect this account. Nothing was changed. Try again later.");
    this.name = "StripeDisconnectUnavailableError";
  }
}

// Stripe answers 403 for an account this platform's key can't see: one made
// under another platform key, or deleted (PAY-015).
function isAccountOutOfReach(error: unknown) {
  const failure = error as { type?: unknown; code?: unknown; message?: unknown } | null;
  return failure?.type === "StripePermissionError" && (failure.code === "account_invalid" || /does not have access to account/i.test(String(failure.message)));
}

// Orders that still depend on the connected account: being paid, under review,
// being refunded or disputed. Pre-T10 orders have no seller snapshot.
const openRefundRequest = { some: { status: { in: ["pending", "uncertain"] } } } satisfies Prisma.RefundRequestListRelationFilter;

function openObligationsWhere(organisationId: string, accountId: string): Prisma.OrderWhereInput {
  return {
    event: { is: { organisationId } },
    paymentKind: "stripe",
    AND: [
      { OR: [{ sellerStripeAccountId: accountId }, { sellerStripeAccountId: null }] },
      {
        OR: [
          { status: "pending" },
          { requiresCompensationReview: true },
          { compensationRefundJob: { is: { state: { in: ["review_required", "auto_queued", "auto_processing", "refund_pending", "refund_failed"] } } } },
          { refundStatus: "processing" },
          { disputeStatus: "open" },
          { refundRequests: openRefundRequest }
        ]
      }
    ]
  };
}

// The same for membership and merchandise orders (T21), which refund through RefundRequest.
function openCommerceObligationsWhere(organisationId: string, accountId: string): Prisma.CommerceOrderWhereInput {
  return {
    organisationId,
    paymentKind: "stripe",
    AND: [
      { OR: [{ sellerStripeAccountId: accountId }, { sellerStripeAccountId: null }] },
      {
        OR: [
          { status: "pending" },
          { requiresCompensationReview: true },
          { refundStatus: "processing" },
          { disputeStatus: "open" },
          { refundRequests: openRefundRequest }
        ]
      }
    ]
  };
}

async function countOpenObligations(client: Pick<Prisma.TransactionClient, "order" | "commerceOrder">, organisationId: string, accountId: string) {
  const tickets = await client.order.count({ where: openObligationsWhere(organisationId, accountId) });
  return tickets + (await client.commerceOrder.count({ where: openCommerceObligationsWhere(organisationId, accountId) }));
}

export class OrganisationStripeConnectValidationError extends Error {
  constructor(message: string, readonly details: ApiErrorDetail[] = []) {
    super(message);
    this.name = "OrganisationStripeConnectValidationError";
  }
}

// Stripe returns staff to the trusted origin they started from, else the app URL.
function settingsUrl(returnOrigin?: string) {
  return new URL("/dashboard/settings", returnOrigin ?? getAppUrl()).toString();
}

function mapAccountState(account: Stripe.Account): StripeConnectState {
  if (!account.details_submitted) {
    return "CONNECTED_INCOMPLETE";
  }

  if (!account.charges_enabled) {
    return "RESTRICTED";
  }

  return "READY";
}

function statusFromAccount(account: Stripe.Account): StripeConnectStatus {
  const state = mapAccountState(account);

  return {
    accountId: account.id,
    connected: true,
    state,
    ready: state === "READY",
    charges_enabled: Boolean(account.charges_enabled),
    payouts_enabled: Boolean(account.payouts_enabled),
    details_submitted: Boolean(account.details_submitted),
    currently_due: account.requirements?.currently_due ?? [],
    eventually_due: account.requirements?.eventually_due ?? [],
    disabled_reason: account.requirements?.disabled_reason ?? null,
    dashboard_available: Boolean(account.details_submitted)
  };
}

export function notConnectedStatus(): StripeConnectStatus {
  return {
    accountId: null,
    connected: false,
    state: "NOT_CONNECTED",
    ready: false,
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
    currently_due: [],
    eventually_due: [],
    disabled_reason: null,
    dashboard_available: false
  };
}

export function platformNotReadyStatus(): StripeConnectStatus {
  return {
    accountId: null,
    connected: false,
    state: "PLATFORM_NOT_READY",
    ready: false,
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
    currently_due: [],
    eventually_due: [],
    disabled_reason: null,
    dashboard_available: false,
    actionUrl: stripePlatformProfileUrl,
    actionRequired: "Complete Stripe Connect platform profile",
    error: "Stripe platform setup incomplete"
  };
}

function isStripeConnectPlatformNotReadyError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  const stripeError = error as Error & {
    type?: string;
    rawType?: string;
    code?: string;
  };
  const type = (stripeError.type ?? stripeError.rawType ?? "").toLowerCase();
  const code = (stripeError.code ?? "").toLowerCase();

  return (
    message.includes("responsibilities of managing losses") ||
    message.includes("signed up for connect") ||
    message.includes("connect/platform-profile") ||
    type.includes("connect") ||
    code.includes("connect")
  );
}

export function isOrganisationStripeReady(
  organisation: Pick<Organisation, "stripeAccountId" | "stripeChargesEnabled">
) {
  return Boolean(organisation.stripeAccountId && organisation.stripeChargesEnabled);
}

export async function createExpressAccount(orgId: string, actorUserId: string) {
  const organisation = await prisma.organisation.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      slug: true,
      stripeAccountId: true
    }
  });

  if (!organisation) {
    throw new Error("Organisation does not exist");
  }

  if (organisation.stripeAccountId) {
    console.info("Stripe Express account already exists", {
      organisationId: organisation.id,
      stripeAccountId: organisation.stripeAccountId
    });
    return {
      accountId: organisation.stripeAccountId,
      orgSlug: organisation.slug
    };
  }

  const stripe = getStripe();
  // One key per connection, so a double click returns the same account instead of
  // leaving an orphan; a society that disconnected and reconnects gets a new one.
  const earlierAccounts = await prisma.auditLog.count({
    where: { organisationId: organisation.id, action: "stripe_connect.account_created" }
  });
  let account: Stripe.Account;

  try {
    account = await stripe.accounts.create(
      {
        type: "express",
        // on_behalf_of makes the society the settlement merchant, which needs card_payments;
        // destination charges need transfers.
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        // PAY-005: Thunderstrux sends the money once each event is over.
        settings: manualPayoutSettings
      },
      { idempotencyKey: `connect-account:${organisation.id}:${earlierAccounts}` }
    );
  } catch (error) {
    if (isStripeConnectPlatformNotReadyError(error)) {
      await prisma.organisation.update({
        where: { id: organisation.id },
        data: {
          stripeAccountStatus: "PLATFORM_NOT_READY",
          stripeChargesEnabled: false,
          stripePayoutsEnabled: false,
          stripeDetailsSubmitted: false
        }
      });

      console.error("Stripe platform setup is incomplete", {
        organisationId: organisation.id,
        actionUrl: stripePlatformProfileUrl
      });

      throw new StripeConnectPlatformNotReadyError();
    }

    throw error;
  }

  await prisma.$transaction([
    prisma.organisation.update({
      where: { id: organisation.id },
      data: {
        stripeAccountId: account.id,
        stripeAccountStatus: "CONNECTED_INCOMPLETE",
        stripeChargesEnabled: false,
        stripePayoutsEnabled: false,
        stripeDetailsSubmitted: false
      }
    }),
    prisma.auditLog.create({
      data: {
        organisationId: organisation.id,
        actorUserId,
        action: "stripe_connect.account_created",
        targetType: "Organisation",
        targetId: organisation.id,
        metadata: { stripeAccountId: account.id }
      }
    })
  ]);

  console.info("Stripe Express account created", {
    organisationId: organisation.id,
    stripeAccountId: account.id
  });

  return {
    accountId: account.id,
    orgSlug: organisation.slug
  };
}

export async function createOnboardingLink(accountId: string, orgSlug: string, returnOrigin?: string) {
  const stripe = getStripe();
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: settingsUrl(returnOrigin),
    return_url: settingsUrl(returnOrigin),
    type: "account_onboarding"
  });

  console.info("Stripe onboarding link generated", {
    stripeAccountId: accountId,
    orgSlug
  });

  return accountLink.url;
}

export async function getAccountStatus(accountId: string) {
  const stripe = getStripe();
  console.info("Stripe account status fetch started", {
    stripeAccountId: accountId
  });
  const account = await stripe.accounts.retrieve(accountId);
  const status = statusFromAccount(account);

  await prisma.organisation.updateMany({
    where: { stripeAccountId: account.id },
    data: {
      stripeAccountStatus: status.state,
      stripeChargesEnabled: status.charges_enabled,
      stripePayoutsEnabled: status.payouts_enabled,
      stripeDetailsSubmitted: status.details_submitted
    }
  });

  console.info("Stripe account status synchronised", {
    stripeAccountId: account.id,
    state: status.state,
    chargesEnabled: status.charges_enabled,
    payoutsEnabled: status.payouts_enabled,
    detailsSubmitted: status.details_submitted
  });

  return status;
}

// account.updated: Stripe doesn't promise event order, so a society's account is
// re-read rather than taken from the event; an account no society uses is ignored.
export async function refreshConnectedAccount(accountId: string) {
  const known = await prisma.organisation.count({ where: { stripeAccountId: accountId } });
  if (known === 0) return { count: 0 };
  return persistConnectedAccountStatus(await getStripe().accounts.retrieve(accountId));
}

export async function persistConnectedAccountStatus(account: Stripe.Account) {
  const status = statusFromAccount(account);

  return prisma.organisation.updateMany({
    where: { stripeAccountId: account.id },
    data: {
      stripeAccountStatus: status.state,
      stripeChargesEnabled: status.charges_enabled,
      stripePayoutsEnabled: status.payouts_enabled,
      stripeDetailsSubmitted: status.details_submitted
    }
  });
}

// Unlinks the account locally; the Stripe account and its money are untouched,
// and past orders keep the account they were paid to. Outside MFA "off", the
// actor confirms with a fresh authenticator code.
export async function disconnectAccount(
  orgId: string,
  { actor, mfaCode }: { actor: { id: string; mfaSessionId?: string }; mfaCode?: string }
) {
  await requireFreshStaffMfa(actor, mfaCode, "Enter your authenticator code to disconnect Stripe");

  // PAY-005: before unlinking, Stripe takes payouts back, so the money still
  // held for events isn't left waiting. A disconnect then refused under the lock
  // below is put back on manual payouts by the payouts worker's next check.
  const linked = await prisma.organisation.findUnique({ where: { id: orgId }, select: { stripeAccountId: true } });
  if (linked?.stripeAccountId) {
    const open = await countOpenObligations(prisma, orgId, linked.stripeAccountId);
    if (open > 0) throw new StripeDisconnectBlockedError(open);
    // Held money would reach the bank at once on Stripe's schedule, before the
    // events it may have to refund have run, so it is paid out here first.
    if ((await heldMoney(orgId, linked.stripeAccountId)).total > 0) throw new StripeDisconnectBlockedError(0, heldMoneyBlocksDisconnect);
    try {
      await restoreStripePayoutSchedule(linked.stripeAccountId);
    } catch (error) {
      // An account out of this platform's reach has no schedule to give back,
      // so it is unlinked here; nothing else could ever unlink it.
      if (!isAccountOutOfReach(error)) {
        const type = (error as { type?: unknown } | null)?.type;
        throw typeof type === "string" && type.startsWith("Stripe") ? new StripeDisconnectUnavailableError() : error;
      }
      logWarn("stripe_connect.disconnect_account_out_of_reach", { organisationId: orgId, stripeAccountId: linked.stripeAccountId });
    }
  }

  await prisma.$transaction(async (tx) => {
    // Locked so a concurrent connect or disconnect sees one outcome.
    const [organisation] = await tx.$queryRaw<Array<{ id: string; stripeAccountId: string | null }>>`
      SELECT "id", "stripeAccountId" FROM "Organisation" WHERE "id" = ${orgId} FOR UPDATE
    `;
    if (!organisation) throw new OrganisationStripeConnectNotFoundError();

    // No account (for example PLATFORM_NOT_READY): only the local state is reset.
    if (organisation.stripeAccountId) {
      const open = await countOpenObligations(tx, organisation.id, organisation.stripeAccountId);
      if (open > 0) throw new StripeDisconnectBlockedError(open);
    }

    await tx.organisation.update({
      where: { id: organisation.id },
      data: {
        stripeAccountId: null,
        stripeAccountStatus: "NOT_CONNECTED",
        stripeChargesEnabled: false,
        stripePayoutsEnabled: false,
        stripeDetailsSubmitted: false
      }
    });
    await tx.auditLog.create({
      data: {
        organisationId: organisation.id,
        actorUserId: actor.id,
        action: "stripe_connect.disconnected",
        targetType: "Organisation",
        targetId: organisation.id,
        metadata: { previousStripeAccountId: organisation.stripeAccountId }
      }
    });
  });
}

// A failed refresh keeps the last known flags, so sales follow them until a
// refresh succeeds; the account.updated webhook keeps them current meanwhile.
export async function markAccountStatusError(
  orgId: string,
  accountId: string,
  message: string
): Promise<StripeConnectStatus> {
  const known = await prisma.organisation.update({
    where: { id: orgId },
    data: { stripeAccountStatus: "ERROR" },
    select: { stripeChargesEnabled: true, stripePayoutsEnabled: true, stripeDetailsSubmitted: true }
  });

  return {
    accountId,
    connected: true,
    state: "ERROR",
    ready: false,
    charges_enabled: known.stripeChargesEnabled,
    payouts_enabled: known.stripePayoutsEnabled,
    details_submitted: known.stripeDetailsSubmitted,
    currently_due: [],
    eventually_due: [],
    disabled_reason: null,
    dashboard_available: known.stripeDetailsSubmitted,
    error: message
  };
}

type FreshCode = { actor: { id: string; mfaSessionId?: string }; mfaCode?: string };

// Stripe's onboarding collects the bank account payouts go to, so starting or
// continuing it needs a fresh authenticator code, like the dashboard link.
export async function startOrganisationStripeOnboarding(orgId: string, { actor, mfaCode }: FreshCode, returnOrigin?: string) {
  await requireFreshStaffMfa(actor, mfaCode, "Enter your authenticator code to continue to Stripe");
  const { accountId, orgSlug } = await createExpressAccount(orgId, actor.id);
  return createOnboardingLink(accountId, orgSlug, returnOrigin);
}

export async function continueOrganisationStripeOnboarding(orgId: string, { actor, mfaCode }: FreshCode, returnOrigin?: string) {
  await requireFreshStaffMfa(actor, mfaCode, "Enter your authenticator code to continue to Stripe");
  const organisation = await prisma.organisation.findUnique({
    where: { id: orgId },
    select: { slug: true, stripeAccountId: true }
  });

  if (!organisation) {
    throw new OrganisationStripeConnectNotFoundError();
  }

  if (!organisation.stripeAccountId) {
    throw new OrganisationStripeConnectValidationError(
      "Stripe account is not connected",
      [
        {
          path: ["organisationId"],
          message: "Connect a Stripe account before continuing onboarding"
        }
      ]
    );
  }

  return createOnboardingLink(
    organisation.stripeAccountId,
    organisation.slug,
    returnOrigin
  );
}

// A single-use, short-lived sign-in to the society's own Express Dashboard
// (balance, payouts, bank details), made when a staff member asks for it. The
// platform's view of the account (dashboard.stripe.com/connect/accounts/...)
// only opens for the platform owner, never for the society.
// Outside MFA "off", an action that can move a society's money needs a fresh authenticator code.
async function requireFreshStaffMfa(actor: { id: string; mfaSessionId?: string }, mfaCode: string | undefined, prompt: string) {
  if (mfaEnforcementMode() === "off") return;
  if (!mfaCode) throw new MfaInputError(prompt);
  const digest = mfaGrantDigest(actor.mfaSessionId);
  if (!digest) throw new MfaRequiredError();
  await verifyStaffMfa(actor.id, mfaCode, digest);
}

// The Express Dashboard can change where payouts go, so opening it needs a fresh code, like disconnect (T53).
export async function createOrganisationDashboardLink(orgId: string, { actor, mfaCode }: FreshCode) {
  await requireFreshStaffMfa(actor, mfaCode, "Enter your authenticator code to open the Stripe dashboard");
  const actorUserId = actor.id;
  const organisation = await prisma.organisation.findUnique({ where: { id: orgId }, select: { stripeAccountId: true, stripeDetailsSubmitted: true } });
  if (!organisation) throw new OrganisationStripeConnectNotFoundError();
  if (!organisation.stripeAccountId || !organisation.stripeDetailsSubmitted) {
    throw new OrganisationStripeConnectValidationError("Stripe setup is not finished", [
      { path: ["organisationId"], message: "Finish Stripe setup before opening the Stripe dashboard" }
    ]);
  }
  const link = await getStripe().accounts.createLoginLink(organisation.stripeAccountId);
  // The Express Dashboard can change where payouts go, so History records who opened it.
  await prisma.auditLog.create({
    data: { organisationId: orgId, actorUserId, action: "stripe_connect.dashboard_opened", targetType: "Organisation", targetId: orgId, metadata: { stripeAccountId: organisation.stripeAccountId } }
  });
  return link.url;
}

export async function getOrganisationStripeConnectStatus(orgId: string) {
  const organisation = await prisma.organisation.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      stripeAccountStatus: true,
      stripeAccountId: true
    }
  });

  if (!organisation) {
    throw new OrganisationStripeConnectNotFoundError();
  }

  if (
    !organisation.stripeAccountId &&
    organisation.stripeAccountStatus === "PLATFORM_NOT_READY"
  ) {
    return platformNotReadyStatus();
  }

  if (!organisation.stripeAccountId) {
    return notConnectedStatus();
  }

  const openObligations = await countOpenObligations(prisma, orgId, organisation.stripeAccountId);
  const payouts = await payoutSummary(orgId, organisation.stripeAccountId);

  try {
    return { ...(await getAccountStatus(organisation.stripeAccountId)), openObligations, payouts };
  } catch (error) {
    console.error("Stripe Connect status refresh failed", {
      organisationId: orgId,
      stripeAccountId: organisation.stripeAccountId,
      error
    });

    if (error instanceof StripeConfigurationError) {
      throw error;
    }

    // The provider's own message stays in the log, not the response.
    return {
      ...(await markAccountStatusError(orgId, organisation.stripeAccountId, "Thunderstrux couldn't reach Stripe to refresh this account.")),
      openObligations,
      payouts
    };
  }
}
