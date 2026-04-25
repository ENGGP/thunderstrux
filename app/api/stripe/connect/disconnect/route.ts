import { NextResponse } from "next/server";
import {
  badRequest,
  forbidden,
  unauthorized,
  validationError
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireStripeConnectAccess
} from "@/lib/auth/access";
import { OrganisationScopeError, requireOrganisationId } from "@/lib/db/organisation-scope";
import { disconnectAccount, notConnectedStatus } from "@/lib/stripe/connect";
import { validateJson } from "@/lib/validators";
import { organisationConnectSchema } from "@/lib/validators/stripe-connect";

export async function POST(request: Request) {
  const validation = await validateJson(request, organisationConnectSchema);

  if (!validation.success) {
    return validationError(validation.details);
  }

  try {
    const organisationId = requireOrganisationId(validation.data.organisationId);
    await requireStripeConnectAccess(organisationId);
    await disconnectAccount(organisationId);

    return NextResponse.json({
      disconnected: true,
      status: notConnectedStatus()
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
        { path: ["organisationId"], message: error.message }
      ]);
    }

    console.error("Stripe Connect disconnect failed", { error });
    return NextResponse.json(
      {
        error: {
          code: "STRIPE_DISCONNECT_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Unable to disconnect Stripe account",
          details: []
        }
      },
      { status: 500 }
    );
  }
}
