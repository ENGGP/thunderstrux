import { NextResponse } from "next/server";
import { AccountVerificationError } from "@/lib/auth/account-lifecycle";
import {
  badRequest,
  forbidden,
  internalError,
  unauthorized,
  validationError,
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  getOrganisationAccessForUser,
  mapOrganisationAccessToOrganisations,
  requireAccountRole,
  requireVerifiedUser,
  requireAuthenticatedUser,
} from "@/lib/auth/access";
import {
  enforceRateLimit,
  getRateLimitClientIp,
} from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";
import { createOrganisationSchema } from "@/lib/validators/orgs";
import { normaliseSlug } from "@/lib/validators/slug";
import { bootstrapOrganisation } from "@/lib/organisations/bootstrap";
import { contextCookieName } from "@/lib/auth/context-cookie";

function failure(error: unknown) {
  if (error instanceof AuthenticationRequiredError) return unauthorized();
  if (
    error instanceof OrganisationAccessError &&
    error.message === "Unable to generate a unique organisation slug"
  )
    return badRequest(error.message, [
      { path: ["slug"], message: "Try a more specific organisation slug" },
    ]);
  if (
    error instanceof OrganisationAccessError ||
    error instanceof AccountVerificationError
  )
    return forbidden(error.message);
  console.error(
    "Organisation bootstrap failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return internalError();
}
export async function GET() {
  try {
    const user = await requireAuthenticatedUser();
    return NextResponse.json({
      organisations: mapOrganisationAccessToOrganisations(
        await getOrganisationAccessForUser(user.id),
      ),
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  const denied = enforceTrustedMutationRequest(request);
  if (denied) return denied;
  try {
    const user = await requireAccountRole("organisation");
    await requireVerifiedUser();
    const limited = await enforceRateLimit({
      policy: "organisation_create",
      request,
      keyParts: [user.id, getRateLimitClientIp(request)],
    });
    if (limited) return limited;
    const input = await validateJson(request, createOrganisationSchema);
    if (!input.success) return validationError(input.details);
    if (!normaliseSlug(input.data.slug ?? input.data.name))
      return badRequest("Organisation slug must contain letters or numbers", [
        { path: ["slug"], message: "Slug could not be generated from input" },
      ]);
    const organisation = await bootstrapOrganisation(user, input.data);
    const response = NextResponse.json({ organisation }, { status: 201 });
    // A retired/personal context must not hide the newly bootstrapped society.
    response.cookies.delete(contextCookieName);
    return response;
  } catch (error) {
    return failure(error);
  }
}
