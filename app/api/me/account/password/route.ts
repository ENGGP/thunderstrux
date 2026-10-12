import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/auth/access";
import { AccountSecurityError, changePassword } from "@/lib/auth/account-lifecycle";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { validateJson } from "@/lib/validators";
import { newPasswordSchema } from "@/lib/validators/auth";
import { forbidden, mapRouteError, routeErrorRule, validationError } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
export async function POST(request: Request) {
  const guard = enforceTrustedMutationRequest(request); if (guard) return guard;
  try {
    const actor = await requireAuthenticatedUser();
    const limit = await enforceRateLimit({ policy: "account_security_change", request, keyParts: [actor.id], required: true }); if (limit) return limit;
    const body = await validateJson(request, z.object({ currentPassword: z.string().min(1).max(200), newPassword: newPasswordSchema }).strict());
    if (!body.success) return validationError(body.details);
    await changePassword(actor, body.data.currentPassword, body.data.newPassword);
    return NextResponse.json({ changed: true, signInRequired: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapRouteError(error, { operation: "account.password_change", request, rules: [
      authenticationRule, staleSessionRule, routeErrorRule(AccountSecurityError, failure => forbidden(failure.message))
    ] });
  }
}
