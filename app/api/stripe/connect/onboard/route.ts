import { NextResponse } from "next/server";
import {
  badRequest,
  forbidden,
  notFound,
  serviceUnavailable,
  unauthorized,
  validationError
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireStripeConnectCapability,
  requireOrganisationStripeConnectAccess
} from "@/lib/auth/access";
import { OrganisationScopeError, requireOrganisationId } from "@/lib/db/organisation-scope";
import {
  startOrganisationStripeOnboarding,
  StripeConnectPlatformNotReadyError
} from "@/lib/stripe/connect";
import { StripeConfigurationError } from "@/lib/stripe";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";
import { organisationConnectSchema } from "@/lib/validators/stripe-connect";

function stripeErrorResponse(error: unknown) {
  console.error("Stripe Connect onboarding failed", { error });
  const message =
    error instanceof Error ? error.message : "Unknown Stripe onboarding error";

  return NextResponse.json(
    {
      error: {
        code: "STRIPE_ONBOARDING_ERROR",
        message,
        details: []
      }
    },
    { status: 502 }
  );
}

export async function POST(request: Request) {
  const trustedOriginError = enforceTrustedMutationRequest(request);

  if (trustedOriginError) {
    return trustedOriginError;
  }

  try {
    await requireStripeConnectCapability();
    const validation = await validateJson(request, organisationConnectSchema);

    if (!validation.success) {
      return validationError(validation.details);
    }

    const organisationId = requireOrganisationId(validation.data.organisationId);
    await requireOrganisationStripeConnectAccess(organisationId);
    const limitResponse = await enforceRateLimit({
      policy: "stripe_connect_mutation",
      request,
      keyParts: [organisationId, "onboard"]
    });

    if (limitResponse) {
      return limitResponse;
    }

    const url = await startOrganisationStripeOnboarding(organisationId);

    return NextResponse.json({ url });
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

    if (error instanceof StripeConfigurationError) {
      console.error("Stripe Connect onboarding configuration error", {
        message: error.message
      });
      return serviceUnavailable(
        "Stripe is not configured. Check STRIPE_SECRET_KEY in the app container environment."
      );
    }

    if (error instanceof StripeConnectPlatformNotReadyError) {
      return NextResponse.json(
        {
          state: error.state,
          message: error.message,
          actionRequired: error.actionRequired,
          actionUrl: error.actionUrl
        },
        { status: 409 }
      );
    }

    return stripeErrorResponse(error);
  }
}
