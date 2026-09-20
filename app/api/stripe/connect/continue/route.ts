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
import { StripeConfigurationError } from "@/lib/stripe";
import {
  continueOrganisationStripeOnboarding,
  OrganisationStripeConnectNotFoundError,
  OrganisationStripeConnectValidationError
} from "@/lib/stripe/connect";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";
import { organisationConnectSchema } from "@/lib/validators/stripe-connect";

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
      keyParts: [organisationId, "continue"]
    });

    if (limitResponse) {
      return limitResponse;
    }

    const url = await continueOrganisationStripeOnboarding(organisationId);

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

    if (error instanceof OrganisationStripeConnectNotFoundError) {
      return notFound(error.message);
    }

    if (error instanceof OrganisationStripeConnectValidationError) {
      return badRequest(error.message, error.details);
    }

    if (error instanceof StripeConfigurationError) {
      console.error("Stripe Connect continue configuration error", {
        message: error.message
      });
      return serviceUnavailable(
        "Stripe is not configured. Check STRIPE_SECRET_KEY in the app container environment."
      );
    }

    console.error("Stripe Connect continue onboarding failed", { error });
    return NextResponse.json(
      {
        error: {
          code: "STRIPE_CONTINUE_ONBOARDING_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Unable to continue Stripe onboarding",
          details: []
        }
      },
      { status: 502 }
    );
  }
}
