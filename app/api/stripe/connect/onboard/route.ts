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
import { requireOrganisationId } from "@/lib/db/organisation-scope";
import {
  createConnectedAccount,
  generateAccountLink
} from "@/lib/stripe/connect";
import { StripeConfigurationError } from "@/lib/stripe";
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
        id: true,
        name: true,
        slug: true,
        stripeAccountId: true
      }
    });

    if (!organisation) {
      return badRequest("Invalid organisationId", [
        { path: ["organisationId"], message: "Organisation does not exist" }
      ]);
    }

    if (organisation.stripeAccountId) {
      return badRequest("Organisation already has a Stripe account", [
        {
          path: ["organisationId"],
          message: "Use the status endpoint for existing accounts"
        }
      ]);
    }

    const accountId = await createConnectedAccount(organisation);
    const url = await generateAccountLink(accountId, organisation.slug);

    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    if (error instanceof StripeConfigurationError) {
      console.error("Stripe Connect onboarding configuration error", {
        message: error.message
      });
      return serviceUnavailable(
        "Stripe is not configured. Check STRIPE_SECRET_KEY in the app container environment."
      );
    }

    console.error("STRIPE ONBOARDING ERROR FULL:", error);
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
}

export async function DELETE(request: Request) {
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
        id: true,
        stripeAccountId: true
      }
    });

    if (!organisation) {
      return badRequest("Invalid organisationId", [
        { path: ["organisationId"], message: "Organisation does not exist" }
      ]);
    }

    await prisma.organisation.update({
      where: { id: organisation.id },
      data: {
        stripeAccountId: null,
        stripeAccountStatus: null,
        stripeChargesEnabled: false,
        stripePayoutsEnabled: false,
        stripeDetailsSubmitted: false
      }
    });

    return NextResponse.json({
      disconnected: true
    });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    console.error("Stripe Connect disconnect failed", { error });
    return NextResponse.json(
      {
        error: {
          code: "STRIPE_DISCONNECT_ERROR",
          message: "Unable to disconnect Stripe account.",
          details: []
        }
      },
      { status: 500 }
    );
  }
}
