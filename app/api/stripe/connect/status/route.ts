import { NextResponse } from "next/server";
import {
  badRequest,
  forbidden,
  internalError,
  unauthorized
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireOrganisationMembershipById
} from "@/lib/auth/access";
import { prisma } from "@/lib/db";
import { OrganisationScopeError, requireOrganisationId } from "@/lib/db/organisation-scope";
import { getStripe } from "@/lib/stripe";
import {
  isOrganisationStripeReady,
  persistConnectedAccountStatus
} from "@/lib/stripe/connect";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    const organisationId = requireOrganisationId(searchParams.get("organisationId"));
    await requireOrganisationMembershipById(organisationId);

    const organisation = await prisma.organisation.findUnique({
      where: { id: organisationId },
      select: {
        id: true,
        stripeAccountId: true,
        stripeChargesEnabled: true
      }
    });

    if (!organisation) {
      return badRequest("Invalid organisationId", [
        { path: ["organisationId"], message: "Organisation does not exist" }
      ]);
    }

    if (!organisation.stripeAccountId) {
      return NextResponse.json({
        connected: false,
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false
      });
    }

    const stripe = getStripe();
    const account = await stripe.accounts.retrieve(organisation.stripeAccountId);
    await persistConnectedAccountStatus(account);

    return NextResponse.json({
      connected: true,
      ready: isOrganisationStripeReady({
        stripeAccountId: organisation.stripeAccountId,
        stripeChargesEnabled: account.charges_enabled
      }),
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted
    });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    if (error instanceof OrganisationScopeError) {
      return badRequest(error.message, [
        { path: ["organisationId"], message: error.message },
        { path: ["x-org-id"], message: error.message }
      ]);
    }

    console.error(error);
    return internalError();
  }
}
