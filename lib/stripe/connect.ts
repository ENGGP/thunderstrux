import type Stripe from "stripe";
import type { Organisation, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ApiErrorDetail } from "@/lib/api/errors";
import { mfaGrantDigest } from "@/lib/security/csrf";
import { MfaInputError, MfaRequiredError, mfaEnforcementMode, verifyStaffMfa } from "@/lib/security/staff-mfa";
import { getAppUrl, getStripe, isLiveStripeKey, StripeConfigurationError } from "@/lib/stripe";

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
  dashboard_url: string | null;
  actionUrl?: string;
  actionRequired?: string;
  error?: string;
  // Orders still tied to this account; while any exist it cannot be disconnected.
  openObligations?: number;
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

export class StripeDisconnectBlockedError extends Error {
  constructor(readonly count: number) {
    super(
      `${count} ${count === 1 ? "order is" : "orders are"} still being paid or reviewed, and ${count === 1 ? "it needs" : "they need"} this Stripe account. Try again once they finish.`
    );
    this.name = "StripeDisconnectBlockedError";
  }
}

// Orders that still depend on the connected account: being paid, or waiting for
// compensation review or a refund. Pre-T10 orders have no seller snapshot.
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
          { compensationRefundJob: { is: { state: { in: ["review_required", "auto_queued", "auto_processing", "refund_pending", "refund_failed"] } } } }
        ]
      }
    ]
  };
}

export class OrganisationStripeConnectValidationError extends Error {
  constructor(message: string, readonly details: ApiErrorDetail[] = []) {
    super(message);
    this.name = "OrganisationStripeConnectValidationError";
  }
}

function stripeDashboardUrl(accountId: string, livemode = isLiveStripeKey()) {
  const modeSegment = livemode ? "" : "test/";
  return `https://dashboard.stripe.com/${modeSegment}connect/accounts/${accountId}`;
}

function settingsUrl() {
  return new URL("/dashboard/settings", getAppUrl()).toString();
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
    dashboard_url: stripeDashboardUrl(account.id)
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
    dashboard_url: null
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
    dashboard_url: null,
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
  let account: Stripe.Account;

  try {
    account = await stripe.accounts.create({
      type: "express"
    });
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

export async function createOnboardingLink(accountId: string, orgSlug: string) {
  const stripe = getStripe();
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: settingsUrl(),
    return_url: settingsUrl(),
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
  if (mfaEnforcementMode() !== "off") {
    if (!mfaCode) throw new MfaInputError("Enter your authenticator code to disconnect Stripe");
    const digest = mfaGrantDigest(actor.mfaSessionId);
    if (!digest) throw new MfaRequiredError();
    await verifyStaffMfa(actor.id, mfaCode, digest);
  }

  await prisma.$transaction(async (tx) => {
    // Locked so a concurrent connect or disconnect sees one outcome.
    const [organisation] = await tx.$queryRaw<Array<{ id: string; stripeAccountId: string | null }>>`
      SELECT "id", "stripeAccountId" FROM "Organisation" WHERE "id" = ${orgId} FOR UPDATE
    `;
    if (!organisation) throw new OrganisationStripeConnectNotFoundError();

    // No account (for example PLATFORM_NOT_READY): only the local state is reset.
    if (organisation.stripeAccountId) {
      const open = await tx.order.count({ where: openObligationsWhere(organisation.id, organisation.stripeAccountId) });
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
    dashboard_url: stripeDashboardUrl(accountId),
    error: message
  };
}

export async function startOrganisationStripeOnboarding(orgId: string, actorUserId: string) {
  const { accountId, orgSlug } = await createExpressAccount(orgId, actorUserId);
  return createOnboardingLink(accountId, orgSlug);
}

export async function continueOrganisationStripeOnboarding(orgId: string) {
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
    organisation.slug
  );
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

  const openObligations = await prisma.order.count({ where: openObligationsWhere(orgId, organisation.stripeAccountId) });

  try {
    return { ...(await getAccountStatus(organisation.stripeAccountId)), openObligations };
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
      openObligations
    };
  }
}
