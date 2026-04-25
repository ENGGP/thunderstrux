import { NextResponse } from "next/server";
import {
  badRequest,
  forbidden,
  serviceUnavailable,
  unauthorized,
  validationError
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireStripeConnectAccess
} from "@/lib/auth/access";
import { OrganisationScopeError, requireOrganisationId } from "@/lib/db/organisation-scope";
import {
  createExpressAccount,
  createOnboardingLink,
  StripeConnectPlatformNotReadyError
} from "@/lib/stripe/connect";
import { StripeConfigurationError } from "@/lib/stripe";
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
  const validation = await validateJson(request, organisationConnectSchema);

  if (!validation.success) {
    return validationError(validation.details);
  }

  try {
    const organisationId = requireOrganisationId(validation.data.organisationId);
    await requireStripeConnectAccess(organisationId);

    const { accountId, orgSlug } = await createExpressAccount(organisationId);
    const url = await createOnboardingLink(accountId, orgSlug);

    return NextResponse.json({ url });
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
