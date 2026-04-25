import { NextResponse } from "next/server";
import {
  badRequest,
  forbidden,
  serviceUnavailable,
  unauthorized
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireOrganisationMembershipById
} from "@/lib/auth/access";
import { prisma } from "@/lib/db";
import { OrganisationScopeError, requireOrganisationId } from "@/lib/db/organisation-scope";
import { StripeConfigurationError } from "@/lib/stripe";
import {
  getAccountStatus,
  markAccountStatusError,
  notConnectedStatus
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
        stripeAccountId: true
      }
    });

    if (!organisation) {
      return badRequest("Invalid organisationId", [
        { path: ["organisationId"], message: "Organisation does not exist" }
      ]);
    }

    if (!organisation.stripeAccountId) {
      return NextResponse.json(notConnectedStatus());
    }

    try {
      return NextResponse.json(
        await getAccountStatus(organisation.stripeAccountId)
      );
    } catch (error) {
      console.error("Stripe Connect status refresh failed", {
        organisationId,
        stripeAccountId: organisation.stripeAccountId,
        error
      });

      if (error instanceof StripeConfigurationError) {
        return serviceUnavailable(
          "Stripe is not configured. Check STRIPE_SECRET_KEY in the app container environment."
        );
      }

      const message =
        error instanceof Error ? error.message : "Unable to refresh Stripe status";

      return NextResponse.json(
        await markAccountStatusError(
          organisationId,
          organisation.stripeAccountId,
          message
        )
      );
    }
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

    console.error("Stripe Connect status endpoint failed", { error });
    return NextResponse.json(
      {
        error: {
          code: "STRIPE_STATUS_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Unable to read Stripe account status",
          details: []
        }
      },
      { status: 500 }
    );
  }
}
