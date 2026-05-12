import { NextResponse } from "next/server";
import {
  forbidden,
  internalError,
  notFound,
  unauthorized
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireAccountRole
} from "@/lib/auth/access";
import { prisma } from "@/lib/db";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";

type RouteContext = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const trustedOriginError = enforceTrustedMutationRequest(request);

  if (trustedOriginError) {
    return trustedOriginError;
  }

  const { orgSlug } = await context.params;

  try {
    const user = await requireAccountRole("member");
    const organisation = await prisma.organisation.findUnique({
      where: { slug: orgSlug },
      select: { id: true, name: true, slug: true }
    });

    if (!organisation) {
      return notFound("Organisation was not found");
    }

    await prisma.organisationMember.deleteMany({
      where: {
        userId: user.id,
        organisationId: organisation.id
      }
    });

    return NextResponse.json({
      organisation: {
        ...organisation,
        joined: false
      }
    });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    console.error("Failed to leave organisation", error);
    return internalError();
  }
}
