import { NextResponse } from "next/server";
import {
  badRequest,
  forbidden,
  notFound,
  serviceUnavailable,
  unauthorized
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireStripeConnectCapability,
  requireOrganisationStripeConnectAccess
} from "@/lib/auth/access";
import { OrganisationScopeError, requireOrganisationId } from "@/lib/db/organisation-scope";
import { StripeConfigurationError } from "@/lib/stripe";
import {
  getOrganisationStripeConnectStatus,
  OrganisationStripeConnectNotFoundError
} from "@/lib/stripe/connect";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    await requireStripeConnectCapability();
    const organisationId = requireOrganisationId(searchParams.get("organisationId"));
    await requireOrganisationStripeConnectAccess(organisationId);

    return NextResponse.json(
      await getOrganisationStripeConnectStatus(organisationId)
    );
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      if (error.message === "Organisation not found or access denied") {
        return notFound("Organisation was not found");
      }

      return forbidden(error.message);
    }

    if (error instanceof OrganisationScopeError) {
      return badRequest(error.message, [
        { path: ["organisationId"], message: error.message },
        { path: ["x-org-id"], message: error.message }
      ]);
    }

    if (error instanceof OrganisationStripeConnectNotFoundError) {
      return notFound(error.message);
    }

    if (error instanceof StripeConfigurationError) {
      return serviceUnavailable(
        "Stripe is not configured. Check STRIPE_SECRET_KEY in the app container environment."
      );
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
