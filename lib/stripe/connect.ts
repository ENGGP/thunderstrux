import type Stripe from "stripe";
import type { Organisation } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getAppUrl, getStripe } from "@/lib/stripe";

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

function isLiveStripeMode() {
  return process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ?? false;
}

function stripeDashboardUrl(accountId: string, livemode = isLiveStripeMode()) {
  const modeSegment = livemode ? "" : "test/";
  return `https://dashboard.stripe.com/${modeSegment}connect/accounts/${accountId}`;
}

function settingsUrl(orgSlug: string) {
  return new URL(`/dashboard/${orgSlug}/settings`, getAppUrl()).toString();
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

export async function createExpressAccount(orgId: string) {
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

  await prisma.organisation.update({
    where: { id: organisation.id },
    data: {
      stripeAccountId: account.id,
      stripeAccountStatus: "CONNECTED_INCOMPLETE",
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
      stripeDetailsSubmitted: false
    }
  });

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
    refresh_url: settingsUrl(orgSlug),
    return_url: settingsUrl(orgSlug),
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

export async function disconnectAccount(orgId: string) {
  const organisation = await prisma.organisation.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      stripeAccountId: true
    }
  });

  if (!organisation) {
    throw new Error("Organisation does not exist");
  }

  await prisma.organisation.update({
    where: { id: organisation.id },
    data: {
      stripeAccountId: null,
      stripeAccountStatus: "NOT_CONNECTED",
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
      stripeDetailsSubmitted: false
    }
  });

  console.info("Stripe account disconnected locally", {
    organisationId: organisation.id,
    previousStripeAccountId: organisation.stripeAccountId
  });
}

export async function markAccountStatusError(
  orgId: string,
  accountId: string,
  message: string
): Promise<StripeConnectStatus> {
  await prisma.organisation.update({
    where: { id: orgId },
    data: {
      stripeAccountStatus: "ERROR",
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
      stripeDetailsSubmitted: false
    }
  });

  return {
    accountId,
    connected: true,
    state: "ERROR",
    ready: false,
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
    currently_due: [],
    eventually_due: [],
    disabled_reason: null,
    dashboard_url: stripeDashboardUrl(accountId),
    error: message
  };
}
