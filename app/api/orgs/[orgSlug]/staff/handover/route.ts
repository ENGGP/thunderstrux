import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthenticationRequiredError, OrganisationAccessError, requireVerifiedUser, requireOrganisationPermission } from "@/lib/auth/access";
import { AccountSecurityError } from "@/lib/auth/account-lifecycle";
import { handOverOrganisationOwnership, StaffHandoverError } from "@/lib/staff/handover";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { validateJson } from "@/lib/validators";
import { staffHandoverSchema } from "@/lib/validators/staff";
import { badRequest, conflict, forbidden, internalError, notFound, unauthorized, validationError } from "@/lib/api/errors";

export async function POST(request: Request, context: { params: Promise<{ orgSlug: string }> }) {
  const denied = enforceTrustedMutationRequest(request); if (denied) return denied;
  const input = await validateJson(request, staffHandoverSchema); if (!input.success) return validationError(input.details);
  try {
    const actor = await requireVerifiedUser(); const { orgSlug } = await context.params;
    const organisation = await prisma.organisation.findUnique({ where: { slug: orgSlug }, select: { id: true } });
    if (!organisation) return notFound("Organisation was not found");
    const authority = await requireOrganisationPermission(organisation.id, "staff:manage");
    if (authority.staffRole !== "owner") return forbidden("Only an active owner can hand over ownership");
    const limited = await enforceRateLimit({ policy: "account_security_change", request, keyParts: [actor.id], required: true }); if (limited) return limited;
    return NextResponse.json(await handOverOrganisationOwnership(actor, organisation.id, input.data), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError || (error instanceof AccountSecurityError && error.kind === "stale_session")) return unauthorized();
    if (error instanceof OrganisationAccessError) return forbidden(error.message);
    if (error instanceof AccountSecurityError) return error.kind === "invalid_password" ? badRequest(error.message) : forbidden(error.message);
    if (error instanceof StaffHandoverError) return error.kind === "conflict" ? conflict(error.message) : forbidden(error.message);
    console.error("Staff ownership handover failed"); return internalError();
  }
}
