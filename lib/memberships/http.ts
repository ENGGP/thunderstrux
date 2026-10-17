import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { apiError, forbidden, mapRouteError, notFound, routeErrorRule, validationError } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
import type { AccountActor } from "@/lib/auth/account-lifecycle";
import { OrganisationAccessError } from "@/lib/auth/access";
import { MembershipPlanError } from "@/lib/memberships/plans";
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
