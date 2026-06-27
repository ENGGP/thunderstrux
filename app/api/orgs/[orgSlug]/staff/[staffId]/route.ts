import { NextResponse } from "next/server";
import {
  conflict,
  forbidden,
  internalError,
  notFound,
  unauthorized,
  validationError
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireAuthenticatedUser,
  requireOrganisationPermission
} from "@/lib/auth/access";
import { prisma } from "@/lib/db";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { writeAuditLog } from "@/lib/staff/audit";
import { validateJson } from "@/lib/validators";
import { updateStaffSchema } from "@/lib/validators/staff";

type RouteContext = {
  params: Promise<{
    orgSlug: string;
    staffId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const trustedOriginError = enforceTrustedMutationRequest(request);

  if (trustedOriginError) {
    return trustedOriginError;
  }

  const validation = await validateJson(request, updateStaffSchema);

  if (!validation.success) {
    return validationError(validation.details);
  }

  const { orgSlug, staffId } = await context.params;

  try {
    const user = await requireAuthenticatedUser();
    const organisation = await prisma.organisation.findUnique({
      where: { slug: orgSlug },
      select: { id: true }
    });

    if (!organisation) {
      return notFound("Organisation was not found");
    }

    await requireOrganisationPermission(organisation.id, "staff:manage");

    const existingStaff = await prisma.organisationStaff.findFirst({
      where: {
        id: staffId,
        organisationId: organisation.id
      },
      select: {
        id: true,
        role: true,
        status: true
      }
    });

    if (!existingStaff) {
      return notFound("Staff member was not found");
    }

    const nextRole = validation.data.role ?? existingStaff.role;
    const nextStatus = validation.data.status ?? existingStaff.status;
    const removesActiveOwner =
      existingStaff.role === "owner" &&
      existingStaff.status === "active" &&
      (nextRole !== "owner" || nextStatus !== "active");

    if (removesActiveOwner) {
      const activeOwnerCount = await prisma.organisationStaff.count({
        where: {
          organisationId: organisation.id,
          role: "owner",
          status: "active"
        }
      });

      if (activeOwnerCount <= 1) {
        return conflict("At least one active owner is required");
      }
    }

    const now = new Date();
    const staff = await prisma.organisationStaff.update({
      where: { id: staffId },
      data: {
        role: nextRole,
        status: nextStatus,
        revokedAt: nextStatus === "revoked" ? now : null,
        revokedById: nextStatus === "revoked" ? user.id : null
      },
      select: {
        id: true,
        role: true,
        status: true,
        acceptedAt: true,
        revokedAt: true,
        user: {
          select: {
            id: true,
            email: true
          }
        }
      }
    });

    await writeAuditLog({
      organisationId: organisation.id,
      actorUserId: user.id,
      action: "staff.updated",
      targetType: "OrganisationStaff",
      targetId: staff.id,
      metadata: {
        previousRole: existingStaff.role,
        previousStatus: existingStaff.status,
        nextRole,
        nextStatus
      }
    });

    return NextResponse.json({ staff });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    console.error("Failed to update organisation staff", {
      orgSlug,
      staffId,
      error
    });
    return internalError();
  }
}
