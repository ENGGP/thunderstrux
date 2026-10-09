import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AuthenticationRequiredError, OrganisationAccessError, requireVerifiedUser, requireOrganisationPermission } from "@/lib/auth/access";
import { badRequest, conflict, forbidden, internalError, notFound, unauthorized, validationError } from "@/lib/api/errors";
import { StaffInviteError, manageOrganisationStaffInvite } from "./invites";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { validateJson } from "@/lib/validators";

export function staffInviteFailure(error: unknown) {
  if (error instanceof AuthenticationRequiredError) return unauthorized();
  if (error instanceof OrganisationAccessError) return forbidden(error.message);
  if (error instanceof StaffInviteError) {
    if (error.kind === "stale_session") return unauthorized();
    if (error.kind === "authority") return forbidden(error.message);
    if (error.kind === "conflict") return conflict(error.message);
    return badRequest(error.message);
  }
  console.error("Staff invitation operation failed");
  return internalError();
}
export async function invitationIssuanceLimits(request: Request, actorId: string, organisationId: string, email: string) {
  return await enforceRateLimit({ policy: "staff_invite_actor", request, keyParts: [actorId, organisationId], required: true }) ??
    await enforceRateLimit({ policy: "staff_invite_email", request, keyParts: [organisationId, email], required: true });
}
export async function manageStaffInviteRequest(request: Request, context: { params: Promise<{ orgSlug: string; inviteId: string }> }, action: "resend" | "revoke") {
  const denied = enforceTrustedMutationRequest(request); if (denied) return denied;
  const input = await validateJson(request, z.object({}).strict()); if (!input.success) return validationError(input.details);
  try {
    const actor = await requireVerifiedUser();
    const { orgSlug, inviteId } = await context.params;
    const organisation = await prisma.organisation.findUnique({ where: { slug: orgSlug }, select: { id: true } });
    if (!organisation) return notFound("Organisation was not found");
    await requireOrganisationPermission(organisation.id, "staff:manage");
    const invite = await prisma.organisationStaffInvite.findFirst({ where: { id: inviteId, organisationId: organisation.id }, select: { email: true } });
    if (!invite) return badRequest("Invitation is unavailable");
    const limited = action === "resend" ? await invitationIssuanceLimits(request, actor.id, organisation.id, invite.email) :
      await enforceRateLimit({ policy: "staff_invite_actor", request, keyParts: [actor.id, organisation.id], required: true });
    if (limited) return limited;
    return NextResponse.json(await manageOrganisationStaffInvite(actor, organisation.id, inviteId, action), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return staffInviteFailure(error); }
}
