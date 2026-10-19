import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { apiError, forbidden, mapRouteError, notFound, routeErrorRule, validationError } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
import type { AccountActor } from "@/lib/auth/account-lifecycle";
import { OrganisationAccessError } from "@/lib/auth/access";
import { MerchandiseCatalogueError } from "@/lib/merchandise/catalogue";
import { organisationActor } from "@/lib/organisations/http";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";

const rules = [
  authenticationRule,
  staleSessionRule,
  // Another society's slug and a missing permission look the same.
  routeErrorRule(OrganisationAccessError, (error) =>
    error.message === "Organisation not found or access denied" ? notFound("Organisation was not found") : forbidden(error.message)
  ),
  routeErrorRule(MerchandiseCatalogueError, (error) =>
    apiError(error.status === 404 ? "NOT_FOUND" : error.status === 409 ? "CONFLICT" : "BAD_REQUEST", error.message, error.status, error.details)
  )
];

const noStore = { "Cache-Control": "private, no-store" };

// POST/PATCH /api/orgs/[orgSlug]/merchandise/...: trusted origin, live
// merchandise:manage (or merchandise:fulfil for pickups, T28a; rechecked
// under lock by the service), a strict body.
export async function productMutation<T>(
  request: Request,
  orgSlug: string,
  schema: ZodType<T>,
  operation: string,
  run: (actor: AccountActor, organisationId: string, input: T) => Promise<unknown>,
  status = 200,
  { permission = "merchandise:manage", key = "product" }: { permission?: "merchandise:manage" | "merchandise:fulfil"; key?: "product" | "pickup" | "return" } = {}
) {
  const denied = enforceTrustedMutationRequest(request);
  if (denied) return denied;
  try {
    const { actor, organisationId } = await organisationActor(orgSlug, permission);
    const body = await validateJson(request, schema);
    if (!body.success) return validationError(body.details);
    return NextResponse.json({ [key]: await run(actor, organisationId, body.data) }, { status, headers: noStore });
  } catch (error) {
    return mapRouteError(error, { operation: `merchandise.${operation}`, request, rules });
  }
}

export async function productRead(request: Request, orgSlug: string, read: (organisationId: string) => Promise<unknown>) {
  try {
    const { organisationId } = await organisationActor(orgSlug, "merchandise:manage");
    const result = await read(organisationId);
    if (result === null) throw new MerchandiseCatalogueError(404, "Product not found");
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    return mapRouteError(error, { operation: "merchandise.read", request, rules });
  }
}
