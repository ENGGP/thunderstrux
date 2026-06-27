import { NextResponse } from "next/server";
import {
  badRequest,
  internalError,
  unauthorized,
  validationError
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  requireAuthenticatedUser
} from "@/lib/auth/access";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { writeAuditLog } from "@/lib/staff/audit";
import {
  StaffInviteError,
  acceptOrganisationStaffInvite
} from "@/lib/staff/invites";
import { validateJson } from "@/lib/validators";
import { acceptStaffInviteSchema } from "@/lib/validators/staff";

export async function POST(request: Request) {
  const trustedOriginError = enforceTrustedMutationRequest(request);

  if (trustedOriginError) {
    return trustedOriginError;
  }

  const validation = await validateJson(request, acceptStaffInviteSchema);

  if (!validation.success) {
    return validationError(validation.details);
  }

  try {
    const user = await requireAuthenticatedUser();
    const result = await acceptOrganisationStaffInvite({
      token: validation.data.token,
      userId: user.id,
      userEmail: user.email
    });

    await writeAuditLog({
      organisationId: result.staff.organisationId,
      actorUserId: user.id,
      action: "staff.invite.accepted",
      targetType: "OrganisationStaffInvite",
      targetId: result.inviteId,
      metadata: {
        staffId: result.staff.id,
        role: result.staff.role
      }
    });

    return NextResponse.json({
      staff: result.staff
    });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof StaffInviteError) {
      return badRequest(error.message);
    }

    console.error("Failed to accept staff invite", { error });
    return internalError();
  }
}
