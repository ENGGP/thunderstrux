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
import { prisma } from "@/lib/db";
import { OrganisationScopeError, requireOrganisationId } from "@/lib/db/organisation-scope";
import { StripeConfigurationError } from "@/lib/stripe";
import { createOnboardingLink } from "@/lib/stripe/connect";
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

    const organisation = await prisma.organisation.findUnique({
      where: { id: organisationId },
      select: {
        slug: true,
        stripeAccountId: true
      }
    });

    if (!organisation?.stripeAccountId) {
      return badRequest("Stripe account is not connected", [
        {
          path: ["organisationId"],
          message: "Connect a Stripe account before continuing onboarding"
        }
      ]);
    }

    const url = await createOnboardingLink(
      organisation.stripeAccountId,
      organisation.slug
    );

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
