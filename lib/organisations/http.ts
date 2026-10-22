import { ZodError } from "zod";
import { OrganisationAccessError, requireAuthenticatedUser, requireOrganisationPermission } from "@/lib/auth/access";
import { organisationIdBySlug } from "./authority";
import { apiError, forbidden, mapRouteError, notFound, routeErrorRule, validationError } from "@/lib/api/errors";
import { authenticationRule } from "@/lib/api/route-rules";
import { AssetError } from "@/lib/assets/image";
import type { OrganisationPermission } from "@/lib/permissions";

export async function organisationActor(orgSlug: string, permission: OrganisationPermission) {
  const actor = await requireAuthenticatedUser();
  const organisationId = await organisationIdBySlug(orgSlug);
  if (!organisationId) throw new OrganisationAccessError("Organisation not found or access denied");
  const { staffRole } = await requireOrganisationPermission(organisationId, permission);
  return { actor, organisationId, staffRole };
}
export function organisationError(error: unknown) {
  // Provider errors can contain signed URLs; the mapper logs only their class.
  return mapRouteError(error, {
    operation: "organisations",
    rules: [
      authenticationRule,
      routeErrorRule(OrganisationAccessError, (denied) => denied.message === "Organisation not found or access denied" ? notFound("Organisation was not found") : forbidden(denied.message)),
      routeErrorRule(ZodError, (invalid) => validationError(invalid.issues.map((issue) => ({ path: issue.path.map(String), message: issue.message })))),
      routeErrorRule(AssetError, (failed) => apiError(failed.status === 404 ? "NOT_FOUND" : failed.status === 409 ? "CONFLICT" : failed.status === 429 ? "RATE_LIMITED" : failed.status === 503 ? "SERVICE_UNAVAILABLE" : "BAD_REQUEST", failed.message, failed.status))
    ]
  });
}
