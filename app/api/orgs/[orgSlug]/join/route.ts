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

type RouteContext = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
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

    await prisma.organisationMember.upsert({
      where: {
        userId_organisationId: {
          userId: user.id,
          organisationId: organisation.id
        }
      },
      update: {
        role: "member"
      },
      create: {
        userId: user.id,
        organisationId: organisation.id,
        role: "member"
      }
    });

    return NextResponse.json({
      organisation: {
        ...organisation,
        joined: true
      }
    });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    console.error("Failed to join organisation", error);
    return internalError();
  }
}
