import { NextResponse } from "next/server";
import {
  badRequest,
  internalError,
  unauthorized,
  validationError
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  getOrganisationMembershipsForUser,
  mapMembershipsToOrganisations,
  requireAuthenticatedUser
} from "@/lib/auth/access";
import { prisma } from "@/lib/db";
import { validateJson } from "@/lib/validators";
import { createOrganisationSchema } from "@/lib/validators/orgs";
import { normaliseSlug } from "@/lib/validators/slug";

function isPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

export async function GET() {
  try {
    const user = await requireAuthenticatedUser();
    const memberships = await getOrganisationMembershipsForUser(user.id);
    const organisations = mapMembershipsToOrganisations(memberships);

    console.log("GET /api/orgs user", {
      userId: user.id,
      email: user.email
    });
    console.log(
      "GET /api/orgs memberships",
      memberships.map((membership) => ({
        role: membership.role,
        organisationId: membership.organisation.id,
        organisationName: membership.organisation.name,
        organisationSlug: membership.organisation.slug
      }))
    );

    return NextResponse.json({ organisations });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    console.error(error);
    return internalError();
  }
}

export async function POST(request: Request) {
  let user: { id: string };

  try {
    user = await requireAuthenticatedUser();
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    console.error(error);
    return internalError();
  }

  const validation = await validateJson(request, createOrganisationSchema);

  if (!validation.success) {
    return validationError(validation.details);
  }

  const baseSlug = normaliseSlug(validation.data.slug ?? validation.data.name);

  if (!baseSlug) {
    return badRequest("Organisation slug must contain letters or numbers", [
      { path: ["slug"], message: "Slug could not be generated from input" }
    ]);
  }

  for (let suffix = 0; suffix < 100; suffix += 1) {
    const slug = suffix === 0 ? baseSlug : `${baseSlug}-${suffix + 1}`;

    try {
      const organisation = await prisma.$transaction(async (tx) => {
        const organisation = await tx.organisation.create({
          data: {
            name: validation.data.name,
            slug
          },
          select: {
            id: true,
            name: true,
            slug: true,
            createdAt: true
          }
        });

        await tx.organisationMember.create({
          data: {
            organisationId: organisation.id,
            userId: user.id,
            role: "org_owner"
          }
        });

        return organisation;
      });

      return NextResponse.json({ organisation }, { status: 201 });
    } catch (error) {
      if (isPrismaErrorCode(error, "P2002")) {
        continue;
      }

      console.error(error);
      return internalError();
    }
  }

  return badRequest("Unable to generate a unique organisation slug", [
    { path: ["slug"], message: "Try a more specific organisation slug" }
  ]);
}
