import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, mapRouteError, routeErrorRule, serviceUnavailable, validationError } from "@/lib/api/errors";
import { authenticationRule } from "@/lib/api/route-rules";
import { requireAuthenticatedUser } from "@/lib/auth/access";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { assertStaffMfaMutationConfiguration, beginStaffMfaEnrollment, confirmPasswordForMfaSetup, MfaConfigurationError, MfaInputError } from "@/lib/security/staff-mfa";
import { validateJson } from "@/lib/validators";

const schema = z.object({ password: z.string().min(1).max(200) }).strict();

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
    const body = await validateJson(request, schema);
    if (!body.success) return validationError(body.details);
    await confirmPasswordForMfaSetup(user.id, body.data.password);
    const setup = await beginStaffMfaEnrollment(user.id, user.email);
    return NextResponse.json(setup, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapRouteError(error, { operation: "mfa.setup", request, rules: [
      authenticationRule,
      routeErrorRule(MfaInputError, failure => forbidden(failure.message)),
      routeErrorRule(MfaConfigurationError, () => serviceUnavailable("Staff verification is unavailable"))
    ] });
  }
}
