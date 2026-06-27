import { NextResponse } from "next/server";
import {
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
import { createOrganisationStaffInvite } from "@/lib/staff/invites";
import { validateJson } from "@/lib/validators";
import { createStaffInviteSchema } from "@/lib/validators/staff";

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

  const validation = await validateJson(request, createStaffInviteSchema);

  if (!validation.success) {
    return validationError(validation.details);
  }

  const { orgSlug } = await context.params;

  try {
    const user = await requireAuthenticatedUser();
    const organisation = await prisma.organisation.findUnique({
      where: { slug: orgSlug },
      select: { id: true, slug: true }
    });

    if (!organisation) {
      return notFound("Organisation was not found");
    }

    await requireOrganisationPermission(organisation.id, "staff:manage");

    const { invite, token } = await createOrganisationStaffInvite({
      organisationId: organisation.id,
      invitedById: user.id,
      email: validation.data.email,
      role: validation.data.role
    });

    await writeAuditLog({
      organisationId: organisation.id,
      actorUserId: user.id,
      action: "staff.invite.created",
      targetType: "OrganisationStaffInvite",
      targetId: invite.id,
      metadata: {
        email: invite.email,
        role: invite.role
      }
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";

    return NextResponse.json(
      {
        invite,
        token,
        acceptUrl: appUrl ? `${appUrl}/staff/invites/accept?token=${token}` : null
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    console.error("Failed to create staff invite", { orgSlug, error });
    return internalError();
  }
}
