import { NextResponse } from "next/server";
import {
  badRequest,
  forbidden,
  internalError,
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
    const url = await generateAccountLink(accountId);

    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    console.error(error);
    return internalError();
  }
}
