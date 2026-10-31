import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";
import { apiError, badRequest, forbidden, mapRouteError, notFound, routeErrorRule, serviceUnavailable, validationError } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
import type { AccountActor } from "@/lib/auth/account-lifecycle";
import { OrganisationAccessError } from "@/lib/auth/access";
import { MerchandiseCatalogueError } from "@/lib/merchandise/catalogue";
import { MembershipPlanError } from "@/lib/memberships/plans";
import { MembershipRevocationError } from "@/lib/memberships/revocation";
import { OrderRefundError } from "@/lib/payments/order-refunds";
import { StripeConfigurationError } from "@/lib/stripe";
import type { OrganisationPermission } from "@/lib/permissions";
import { requireFreshStaffMfa } from "@/lib/security/fresh-staff-mfa";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { MfaConfigurationError, MfaInputError, MfaRequiredError } from "@/lib/security/staff-mfa";
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
  // A refund also needs the order's short reference typed back.
  confirmation: z.string().trim().min(1).max(20).optional(),
  mfaCode: z.string().trim().max(20).optional()
}).strict();

// The 409 detail names what the action was on: a membership grant or a merchandise order (API-002).
const endRules = (target: "grantId" | "orderId") => [
  authenticationRule,
  staleSessionRule,
  routeErrorRule(MfaRequiredError, (error) => forbidden(error.message)),
  routeErrorRule(OrganisationAccessError, (error) =>
    error.message === "Organisation not found or access denied" ? notFound("Organisation was not found") : forbidden(error.message)
  ),
  routeErrorRule(MfaInputError, (error) => badRequest(error.message, [{ path: ["mfaCode"], message: error.message }])),
  routeErrorRule(MfaConfigurationError, () => serviceUnavailable("Staff verification is unavailable")),
  routeErrorRule(MembershipRevocationError, (error) =>
    error.kind === "not_found" ? notFound(error.message) : apiError("CONFLICT", error.message, 409, [{ path: [target], message: error.message, reason: error.kind }])
  ),
  routeErrorRule(MerchandiseCatalogueError, (error) =>
    apiError(error.status === 404 ? "NOT_FOUND" : error.status === 409 ? "CONFLICT" : "BAD_REQUEST", error.message, error.status, error.details)
  ),
  routeErrorRule(StripeConfigurationError, () => serviceUnavailable("Stripe is not configured.")),
  routeErrorRule(OrderRefundError, (error) =>
    error.kind === "not_found"
      ? notFound(error.message)
      : error.kind === "confirmation_mismatch"
        ? badRequest(error.message, [{ path: ["confirmation"], message: error.message, reason: error.kind }])
        : apiError("CONFLICT", error.message, 409, [{ path: [target], message: error.message, reason: error.kind }])
  )
];

// Staff actions that end or undo a purchase: membership revoke, cancel (T23b)
// and refund (T23c), and merchandise refund and free cancellation (T28b).
// Trusted origin, live permission, a reason and, unless staff MFA is off, a
// fresh authenticator code, as for ticket refunds and free cancellations.
export async function staffEndRoute(
  request: Request,
  orgSlug: string,
  permission: OrganisationPermission,
  operation: string,
  run: (organisationId: string, actor: { id: string }, body: z.infer<typeof endSchema>) => Promise<unknown>,
  status: (result: unknown) => number = () => 200
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
    await requireFreshStaffMfa(actor, body.data.mfaCode, "Enter your authenticator code to continue");
    const result = await run(organisationId, { id: actor.id }, body.data);
    return NextResponse.json(result, { status: status(result), headers: noStore });
  } catch (error) {
    return mapRouteError(error, { operation, request, rules: endRules(operation.startsWith("merchandise.") ? "orderId" : "grantId") });
  }
}
