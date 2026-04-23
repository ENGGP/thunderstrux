import type { Organisation } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getAppUrl, getStripe } from "@/lib/stripe";

type ConnectOrganisation = Pick<
  Organisation,
  "id" | "name" | "slug" | "stripeAccountId"
>;

export async function createConnectedAccount(
  organisation: ConnectOrganisation
) {
  if (organisation.stripeAccountId) {
    return organisation.stripeAccountId;
  }

  const stripe = getStripe();
  const account = await stripe.accounts.create({
    type: "express",
    metadata: {
      organisationId: organisation.id,
      organisationSlug: organisation.slug
    },
    business_profile: {
      name: organisation.name
    }
  });

  await prisma.organisation.update({
    where: { id: organisation.id },
    data: {
      stripeAccountId: account.id,
      stripeAccountStatus: "onboarding_pending"
    }
  });

  return account.id;
}

export function isOrganisationStripeReady(
  organisation: Pick<Organisation, "stripeAccountId" | "stripeChargesEnabled">
) {
  return Boolean(organisation.stripeAccountId && organisation.stripeChargesEnabled);
}

export async function persistConnectedAccountStatus(account: {
  id: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
}) {
  const chargesEnabled = Boolean(account.charges_enabled);
  const payoutsEnabled = Boolean(account.payouts_enabled);
  const detailsSubmitted = Boolean(account.details_submitted);

  const status =
    chargesEnabled && payoutsEnabled && detailsSubmitted
      ? "active"
      : "onboarding_pending";

  return prisma.organisation.updateMany({
    where: { stripeAccountId: account.id },
    data: {
      stripeAccountStatus: status,
      stripeChargesEnabled: chargesEnabled,
      stripePayoutsEnabled: payoutsEnabled,
      stripeDetailsSubmitted: detailsSubmitted
    }
  });
}

export async function generateAccountLink(accountId: string) {
  const organisation = await prisma.organisation.findFirst({
    where: { stripeAccountId: accountId },
    select: { slug: true }
  });

  if (!organisation) {
    throw new Error("Organisation not found for connected Stripe account");
  }

  const settingsUrl = `${getAppUrl()}/dashboard/${organisation.slug}/settings`;
  const stripe = getStripe();

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: settingsUrl,
    return_url: settingsUrl,
    type: "account_onboarding"
  });

  return accountLink.url;
}
