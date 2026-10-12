import { NextResponse } from "next/server";
import { badRequest, forbidden, mapRouteError, routeErrorRule, serviceUnavailable, unauthorized } from "@/lib/api/errors";
import { authenticationRule } from "@/lib/api/route-rules";
import { requireAuthenticatedUser } from "@/lib/auth/access";
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
    return mapRouteError(error, { operation: "mfa.verify", request, rules: [
      authenticationRule,
      routeErrorRule(MfaRequiredError, failure => forbidden(failure.message)),
      routeErrorRule(MfaInputError, failure => badRequest(failure.message)),
      routeErrorRule(MfaConfigurationError, () => serviceUnavailable("Staff verification is unavailable"))
    ] });
  }
}
