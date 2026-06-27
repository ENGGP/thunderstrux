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
  requireOrganisationPermission
} from "@/lib/auth/access";
import { prisma } from "@/lib/db";

type RouteContext = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { orgSlug } = await context.params;

  try {
    const organisation = await prisma.organisation.findUnique({
      where: { slug: orgSlug },
      select: { id: true }
    });

    if (!organisation) {
      return notFound("Organisation was not found");
    }

    await requireOrganisationPermission(organisation.id, "staff:manage");

    const [staff, invites] = await Promise.all([
      prisma.organisationStaff.findMany({
        where: { organisationId: organisation.id },
        orderBy: [{ status: "asc" }, { role: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          role: true,
          status: true,
          createdAt: true,
          acceptedAt: true,
          revokedAt: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true
            }
          }
        }
      }),
      prisma.organisationStaffInvite.findMany({
        where: {
          organisationId: organisation.id,
          acceptedAt: null,
          revokedAt: null
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          role: true,
          expiresAt: true,
          createdAt: true
        }
      })
    ]);

    return NextResponse.json({ staff, invites });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    console.error("Failed to list organisation staff", { orgSlug, error });
    return internalError();
  }
}
