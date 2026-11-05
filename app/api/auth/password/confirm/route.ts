import { NextResponse } from "next/server";
import { z } from "zod";
import { AccountTokenError, consumePasswordReset } from "@/lib/auth/account-lifecycle";
import { knownDeviceSetCookie } from "@/lib/auth/known-device";
import { lifecycleRedemptionLimit } from "@/lib/auth/lifecycle-http";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";
import { newPasswordSchema } from "@/lib/validators/auth";
import { badRequest, mapRouteError, routeErrorRule, validationError } from "@/lib/api/errors";
export async function POST(request: Request) {
  const guard = enforceTrustedMutationRequest(request); if (guard) return guard;
  const body = await validateJson(request, z.object({ token: z.string().min(1).max(100), newPassword: newPasswordSchema }).strict());
  if (!body.success) return validationError(body.details);
  const limit = await lifecycleRedemptionLimit(request, body.data.token); if (limit) return limit;
  try {
    // SEC-063: the browser that proved the inbox signs in on its own bucket, so someone
    // filling the account's shared login_email budget can't keep the owner out after a reset.
    const { account, ...result } = await consumePasswordReset(body.data.token, body.data.newPassword);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store", "Set-Cookie": knownDeviceSetCookie(account) } });
  }
  catch (error) { return mapRouteError(error, { operation: "auth.password_confirm", request, rules: [routeErrorRule(AccountTokenError, (invalid) => badRequest(invalid.message))] }); }
}
