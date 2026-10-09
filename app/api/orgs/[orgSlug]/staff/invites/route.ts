import { NextResponse } from "next/server";
import { forbidden, notFound, validationError } from "@/lib/api/errors";
import { requireVerifiedUser, requireOrganisationPermission } from "@/lib/auth/access";
import { prisma } from "@/lib/db";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { createOrganisationStaffInvite } from "@/lib/staff/invites";
import { invitationIssuanceLimits, staffInviteFailure } from "@/lib/staff/invite-http";
import { validateJson } from "@/lib/validators";
import { createStaffInviteSchema } from "@/lib/validators/staff";

export async function POST(request: Request, context: { params: Promise<{ orgSlug: string }> }) {
  const denied = enforceTrustedMutationRequest(request); if (denied) return denied;
  const input = await validateJson(request, createStaffInviteSchema); if (!input.success) return validationError(input.details);
  try {
    const actor = await requireVerifiedUser();
    const { orgSlug } = await context.params;
    const organisation = await prisma.organisation.findUnique({ where: { slug: orgSlug }, select: { id: true } });
    if (!organisation) return notFound("Organisation was not found");
    const authority = await requireOrganisationPermission(organisation.id, "staff:manage");
    if (input.data.role === "owner" && authority.staffRole !== "owner") return forbidden("Only owners can invite owners");
    const limited = await invitationIssuanceLimits(request, actor.id, organisation.id, input.data.email); if (limited) return limited;
    return NextResponse.json(await createOrganisationStaffInvite({ organisationId: organisation.id, actor, ...input.data }), {
      status: 201, headers: { "Cache-Control": "private, no-store" }
    });
  } catch (error) { return staffInviteFailure(error); }
}
