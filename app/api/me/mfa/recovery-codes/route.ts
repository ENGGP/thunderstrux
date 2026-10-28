import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, mapRouteError, routeErrorRule, serviceUnavailable, validationError } from "@/lib/api/errors";
import { authenticationRule } from "@/lib/api/route-rules";
import { requireAuthenticatedUser } from "@/lib/auth/access";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { assertStaffMfaMutationConfiguration, MfaConfigurationError, MfaInputError, replaceRecoveryCodes } from "@/lib/security/staff-mfa";
import { validateJson } from "@/lib/validators";

const schema = z.object({ password: z.string().min(1).max(200), code: z.string().trim().max(20) }).strict();

// A new set of recovery codes for an enrolled staff member (UI-018): the
// password and a current authenticator code, on the verify rate limit.
export async function POST(request: Request) {
  const guard = enforceTrustedMutationRequest(request);
  if (guard) return guard;
  try {
    assertStaffMfaMutationConfiguration();
    const user = await requireAuthenticatedUser();
    const limit = await enforceRateLimit({ policy: "staff_mfa_verify", request, keyParts: [user.id] });
    if (limit) return limit;
    const body = await validateJson(request, schema);
    if (!body.success) return validationError(body.details);
    const result = await replaceRecoveryCodes(user.id, body.data.password, body.data.code);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapRouteError(error, { operation: "mfa.recovery_codes", request, rules: [
      authenticationRule,
      routeErrorRule(MfaInputError, failure => badRequest(failure.message)),
      routeErrorRule(MfaConfigurationError, () => serviceUnavailable("Staff verification is unavailable"))
    ] });
  }
}
