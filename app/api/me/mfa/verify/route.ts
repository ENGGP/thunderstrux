import { NextResponse } from "next/server";
import { badRequest, forbidden, internalError, unauthorized, serviceUnavailable } from "@/lib/api/errors";
import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/auth/access";
import { mfaGrantDigest } from "@/lib/security/csrf";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { assertStaffMfaMutationConfiguration, MfaConfigurationError, MfaInputError, MfaRequiredError, verifyStaffMfa } from "@/lib/security/staff-mfa";

export async function POST(request: Request) {
  const guard = enforceTrustedMutationRequest(request);
  if (guard) return guard;
  try {
    assertStaffMfaMutationConfiguration();
    const user = await requireAuthenticatedUser();
    const digest = mfaGrantDigest(user.mfaSessionId);
    if (!digest) return unauthorized();
    const limit = await enforceRateLimit({ policy: "staff_mfa_verify", request,
      keyParts: [user.id] });
    if (limit) return limit;
    const body = await request.json().catch(() => null);
    if (!body || typeof body.code !== "string") return badRequest("MFA code is required");
    await verifyStaffMfa(user.id, body.code, digest);
    return NextResponse.json({ verified: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return unauthorized();
    if (error instanceof MfaRequiredError) return forbidden(error.message);
    if (error instanceof MfaInputError) return badRequest(error.message);
    if (error instanceof MfaConfigurationError) return serviceUnavailable("Staff verification is unavailable");
    console.error("Failed to verify MFA", error);
    return internalError();
  }
}
