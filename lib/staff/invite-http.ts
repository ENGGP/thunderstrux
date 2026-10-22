import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { OrganisationAccessError, requireVerifiedUser, requireOrganisationPermission } from "@/lib/auth/access";
import { badRequest, conflict, forbidden, mapRouteError, notFound, routeErrorRule, unauthorized, validationError } from "@/lib/api/errors";
import { authenticationRule } from "@/lib/api/route-rules";
import { organisationIdBySlug } from "@/lib/organisations/authority";
import { StaffInviteError, manageOrganisationStaffInvite } from "./invites";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { validateJson } from "@/lib/validators";

export function staffInviteFailure(error: unknown) {
  return mapRouteError(error, {
    operation: "staff.invites",
    rules: [
      authenticationRule,
      routeErrorRule(OrganisationAccessError, (denied) => forbidden(denied.message)),
      routeErrorRule(StaffInviteError, (failed) =>
        failed.kind === "stale_session" ? unauthorized() : failed.kind === "authority" ? forbidden(failed.message) : failed.kind === "conflict" ? conflict(failed.message) : badRequest(failed.message)
      )
    ]
  });
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
    const organisationId = await organisationIdBySlug(orgSlug);
    if (!organisationId) return notFound("Organisation was not found");
    await requireOrganisationPermission(organisationId, "staff:manage");
    const invite = await prisma.organisationStaffInvite.findFirst({ where: { id: inviteId, organisationId }, select: { email: true } });
    if (!invite) return badRequest("Invitation is unavailable");
    const limited = action === "resend" ? await invitationIssuanceLimits(request, actor.id, organisationId, invite.email) :
      await enforceRateLimit({ policy: "staff_invite_actor", request, keyParts: [actor.id, organisationId], required: true });
    if (limited) return limited;
    return NextResponse.json(await manageOrganisationStaffInvite(actor, organisationId, inviteId, action), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return staffInviteFailure(error); }
}
