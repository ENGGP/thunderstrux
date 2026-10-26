import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, mapRouteError, routeErrorRule, serviceUnavailable, unauthorized } from "@/lib/api/errors";
import { authenticationRule } from "@/lib/api/route-rules";
import { requireAuthenticatedUser } from "@/lib/auth/access";
import { validateJson } from "@/lib/validators";
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
    // Bounded like every JSON body (SEC-028).
    const body = await validateJson(request, z.object({ code: z.string() }).strict());
    if (!body.success) return badRequest("MFA code is required");
    await verifyStaffMfa(user.id, body.data.code, digest);
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
