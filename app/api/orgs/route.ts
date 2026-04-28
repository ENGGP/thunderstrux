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
  getOrganisationMembershipsForUser,
  mapMembershipsToOrganisations,
  requireAccountRole,
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
    user = await requireAccountRole("organisation");
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
        const existingOrganisation = await tx.organisation.findUnique({
          where: {
            accountUserId: user.id
          },
          select: {
            id: true
          }
        });

        if (existingOrganisation) {
          throw new OrganisationAccessError(
            "Organisation account already has an organisation"
          );
        }

        const organisation = await tx.organisation.create({
          data: {
            name: validation.data.name,
            slug,
            accountUserId: user.id
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

      if (error instanceof OrganisationAccessError) {
        return forbidden(error.message);
      }

      console.error(error);
      return internalError();
    }
  }

  return badRequest("Unable to generate a unique organisation slug", [
    { path: ["slug"], message: "Try a more specific organisation slug" }
  ]);
}
