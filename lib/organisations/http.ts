import { ZodError } from "zod";
import { AuthenticationRequiredError, OrganisationAccessError, requireAuthenticatedUser, requireOrganisationPermission } from "@/lib/auth/access";
import { organisationIdBySlug } from "./authority";
import { forbidden, internalError, notFound, unauthorized, validationError, apiError } from "@/lib/api/errors";
import { AssetError } from "@/lib/assets/image";
import type { OrganisationPermission } from "@/lib/permissions";

export async function organisationActor(orgSlug: string, permission: OrganisationPermission) {
  const actor = await requireAuthenticatedUser();
  const organisationId = await organisationIdBySlug(orgSlug);
  if (!organisationId) throw new OrganisationAccessError("Organisation not found or access denied");
  await requireOrganisationPermission(organisationId, permission);
  return { actor, organisationId };
}
export function organisationError(error: unknown) {
  if (error instanceof AuthenticationRequiredError) return unauthorized();
  if (error instanceof OrganisationAccessError) return error.message === "Organisation not found or access denied" ? notFound("Organisation was not found") : forbidden(error.message);
  if (error instanceof ZodError) return validationError(error.issues.map(issue => ({ path: issue.path.map(String), message: issue.message })));
  if (error instanceof AssetError) return apiError(error.status === 404 ? "NOT_FOUND" : error.status === 409 ? "CONFLICT" : error.status === 429 ? "RATE_LIMITED" : error.status === 503 ? "SERVICE_UNAVAILABLE" : "BAD_REQUEST", error.message, error.status);
  // Provider errors can contain signed URLs; log only their class.
  console.error("Organisation request failed", error instanceof Error ? error.name : "UnknownError");
  return internalError();
}
