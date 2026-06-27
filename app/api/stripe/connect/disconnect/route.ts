import { NextResponse } from "next/server";
import {
  badRequest,
  forbidden,
  notFound,
  unauthorized,
  validationError
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireOrganisationStripeConnectAccess
} from "@/lib/auth/access";
import { OrganisationScopeError, requireOrganisationId } from "@/lib/db/organisation-scope";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { disconnectAccount, notConnectedStatus } from "@/lib/stripe/connect";
import { validateJson } from "@/lib/validators";
import { organisationConnectSchema } from "@/lib/validators/stripe-connect";

export async function POST(request: Request) {
  const trustedOriginError = enforceTrustedMutationRequest(request);

  if (trustedOriginError) {
    return trustedOriginError;
  }

  try {
    const validation = await validateJson(request, organisationConnectSchema);

    if (!validation.success) {
      return validationError(validation.details);
    }

    const organisationId = requireOrganisationId(validation.data.organisationId);
    await requireOrganisationStripeConnectAccess(organisationId);
    const limitResponse = await enforceRateLimit({
      policy: "stripe_connect_mutation",
      request,
      keyParts: [organisationId, "disconnect"]
    });

    if (limitResponse) {
      return limitResponse;
    }

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
      if (error.message === "Organisation not found or access denied") {
        return notFound("Organisation was not found");
      }

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
