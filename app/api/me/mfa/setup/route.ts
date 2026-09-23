import { NextResponse } from "next/server";
import { forbidden, internalError, unauthorized, badRequest, serviceUnavailable } from "@/lib/api/errors";
import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/auth/access";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { assertStaffMfaMutationConfiguration, beginStaffMfaEnrollment, MfaConfigurationError, MfaInputError } from "@/lib/security/staff-mfa";

export async function POST(request: Request) {
  const guard = enforceTrustedMutationRequest(request);
  if (guard) return guard;
  try {
    assertStaffMfaMutationConfiguration();
    const user = await requireAuthenticatedUser();
    if (!user.email) return badRequest("Account email is required");
    const limit = await enforceRateLimit({ policy: "staff_mfa_setup", request,
      keyParts: [user.id] });
    if (limit) return limit;
    const setup = await beginStaffMfaEnrollment(user.id, user.email);
    return NextResponse.json(setup, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return unauthorized();
    if (error instanceof MfaInputError) return forbidden(error.message);
    if (error instanceof MfaConfigurationError) return serviceUnavailable("Staff verification is unavailable");
    console.error("Failed to begin MFA setup", error);
    return internalError();
  }
}
