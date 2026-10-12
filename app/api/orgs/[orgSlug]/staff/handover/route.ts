import { NextResponse } from "next/server";
import { requireVerifiedUser, requireOrganisationPermission } from "@/lib/auth/access";
import { AccountSecurityError } from "@/lib/auth/account-lifecycle";
import { organisationIdBySlug } from "@/lib/organisations/authority";
import { handOverOrganisationOwnership, StaffHandoverError } from "@/lib/staff/handover";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { validateJson } from "@/lib/validators";
import { staffHandoverSchema } from "@/lib/validators/staff";
import { badRequest, conflict, forbidden, mapRouteError, notFound, routeErrorRule, validationError } from "@/lib/api/errors";
import { authenticationRule, organisationAccessRule, staleSessionRule } from "@/lib/api/route-rules";

export async function POST(request: Request, context: { params: Promise<{ orgSlug: string }> }) {
  const denied = enforceTrustedMutationRequest(request); if (denied) return denied;
  const input = await validateJson(request, staffHandoverSchema); if (!input.success) return validationError(input.details);
  try {
    const actor = await requireVerifiedUser(); const { orgSlug } = await context.params;
    const organisationId = await organisationIdBySlug(orgSlug);
    if (!organisationId) return notFound("Organisation was not found");
    const authority = await requireOrganisationPermission(organisationId, "staff:manage");
    if (authority.staffRole !== "owner") return forbidden("Only an active owner can hand over ownership");
    const limited = await enforceRateLimit({ policy: "account_security_change", request, keyParts: [actor.id], required: true }); if (limited) return limited;
    return NextResponse.json(await handOverOrganisationOwnership(actor, organisationId, input.data), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return mapRouteError(error, { operation: "staff.handover", request, rules: [
      authenticationRule, staleSessionRule, organisationAccessRule,
      routeErrorRule(AccountSecurityError, failure => failure.kind === "invalid_password" ? badRequest(failure.message) : forbidden(failure.message)),
      routeErrorRule(StaffHandoverError, failure => failure.kind === "conflict" ? conflict(failure.message) : forbidden(failure.message))
    ] });
  }
}
