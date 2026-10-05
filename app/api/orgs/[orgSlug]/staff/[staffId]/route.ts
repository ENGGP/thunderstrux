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
import { StaffUpdateError, updateOrganisationStaff } from "@/lib/staff/management";
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

    const staff = await updateOrganisationStaff(user, organisation.id, staffId, validation.data);

    return NextResponse.json({ staff });
  } catch (error) {
    if (error instanceof StaffUpdateError) {
      if (error.kind === "not_found") return notFound(error.message);
      if (error.kind === "stale_session") return unauthorized();
      if (error.kind === "conflict") return conflict(error.message);
      return forbidden(error.message);
    }
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
