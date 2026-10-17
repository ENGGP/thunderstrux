import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";
import { apiError, badRequest, forbidden, mapRouteError, notFound, routeErrorRule, serviceUnavailable, validationError } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
import type { AccountActor } from "@/lib/auth/account-lifecycle";
import { OrganisationAccessError } from "@/lib/auth/access";
import { MembershipPlanError } from "@/lib/memberships/plans";
import { MembershipRevocationError } from "@/lib/memberships/revocation";
import type { OrganisationPermission } from "@/lib/permissions";
import { mfaGrantDigest } from "@/lib/security/csrf";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { MfaConfigurationError, MfaInputError, MfaRequiredError, mfaEnforcementMode, verifyStaffMfa } from "@/lib/security/staff-mfa";
import { organisationActor } from "@/lib/organisations/http";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";

const rules = [
  authenticationRule,
  staleSessionRule,
  // Another society's slug and a missing permission look the same; a missing
  // authenticator check says so, as the other organisation routes do.
  routeErrorRule(OrganisationAccessError, (error) =>
    error.message === "Organisation not found or access denied" ? notFound("Organisation was not found") : forbidden(error.message)
  ),
  routeErrorRule(MembershipPlanError, (error) =>
    apiError(error.status === 404 ? "NOT_FOUND" : error.status === 409 ? "CONFLICT" : "BAD_REQUEST", error.message, error.status, error.details)
  )
];

const noStore = { "Cache-Control": "private, no-store" };

// POST/PATCH /api/orgs/[orgSlug]/memberships/...: trusted origin, live
// memberships:manage (rechecked under lock by the service), a strict body.
export async function planMutation<T>(
  request: Request,
  orgSlug: string,
  schema: ZodType<T>,
  operation: string,
  run: (actor: AccountActor, organisationId: string, input: T) => Promise<unknown>,
  status = 200
) {
  const denied = enforceTrustedMutationRequest(request);
  if (denied) return denied;
  try {
    const { actor, organisationId } = await organisationActor(orgSlug, "memberships:manage");
    const body = await validateJson(request, schema);
    if (!body.success) return validationError(body.details);
    return NextResponse.json({ plan: await run(actor, organisationId, body.data) }, { status, headers: noStore });
  } catch (error) {
    return mapRouteError(error, { operation: `memberships.${operation}`, request, rules });
  }
}

export async function planRead(request: Request, orgSlug: string, read: (organisationId: string) => Promise<unknown>) {
  try {
    const { organisationId } = await organisationActor(orgSlug, "memberships:manage");
    return NextResponse.json(await read(organisationId), { headers: noStore });
  } catch (error) {
    return mapRouteError(error, { operation: "memberships.read", request, rules });
  }
}

const endSchema = z.object({
  reason: z.string().trim().min(8, "Give a reason of at least 8 characters").max(500),
  mfaCode: z.string().trim().max(20).optional()
}).strict();

const endRules = [
  authenticationRule,
  staleSessionRule,
  routeErrorRule(MfaRequiredError, (error) => forbidden(error.message)),
  routeErrorRule(OrganisationAccessError, (error) =>
    error.message === "Organisation not found or access denied" ? notFound("Organisation was not found") : forbidden(error.message)
  ),
  routeErrorRule(MfaInputError, (error) => badRequest(error.message, [{ path: ["mfaCode"], message: error.message }])),
  routeErrorRule(MfaConfigurationError, () => serviceUnavailable("Staff verification is unavailable")),
  routeErrorRule(MembershipRevocationError, (error) =>
    error.kind === "not_found" ? notFound(error.message) : apiError("CONFLICT", error.message, 409, [{ path: ["grantId"], message: error.message, reason: error.kind }])
  )
];

// POST .../memberships/members/[grantId]/revoke and /cancel (T23b): trusted
// origin, live permission, a reason and, unless staff MFA is off, a fresh
// authenticator code, as for refunds and free cancellations.
export async function endMembershipRoute(
  request: Request,
  orgSlug: string,
  permission: OrganisationPermission,
  operation: string,
  run: (organisationId: string, actor: { id: string }, reason: string) => Promise<unknown>
) {
  const denied = enforceTrustedMutationRequest(request);
  if (denied) return denied;
  try {
    const { actor, organisationId } = await organisationActor(orgSlug, permission);
    const body = await validateJson(request, endSchema);
    if (!body.success) return validationError(body.details);
    if (body.data.mfaCode) {
      const limited = await enforceRateLimit({ policy: "staff_mfa_verify", request, keyParts: [actor.id] });
      if (limited) return limited;
    }
    if (mfaEnforcementMode() !== "off") {
      if (!body.data.mfaCode) throw new MfaInputError("Enter your authenticator code to end this membership");
      const digest = mfaGrantDigest(actor.mfaSessionId);
      if (!digest) throw new MfaRequiredError();
      await verifyStaffMfa(actor.id, body.data.mfaCode, digest);
    }
    return NextResponse.json(await run(organisationId, { id: actor.id }, body.data.reason), { headers: noStore });
  } catch (error) {
    return mapRouteError(error, { operation: `memberships.${operation}`, request, rules: endRules });
  }
}
