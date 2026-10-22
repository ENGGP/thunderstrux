import { z } from "zod";
import { requireAuthenticatedUser } from "./access";
import { AccountSecurityError, AccountTokenError, type AccountActor } from "./account-lifecycle";
import { EmailChangeError } from "./email-change";
import { lifecycleRedemptionLimit } from "./lifecycle-http";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { validateJson } from "@/lib/validators";
import { badRequest, forbidden, mapRouteError, routeErrorRule, validationError } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
export const currentPasswordSchema = z.string().min(1).max(200);
export async function accountSecurityMutation<T>(request: Request, schema: z.ZodType<T>, perform: (actor: AccountActor, body: T) => Promise<Response>, rawToken?: (body: T) => string) {
  const guard = enforceTrustedMutationRequest(request); if (guard) return guard;
  try {
    const actor = await requireAuthenticatedUser();
    const limit = await enforceRateLimit({ policy: "account_security_change", request, keyParts: [actor.id], required: true }); if (limit) return limit;
    const body = await validateJson(request, schema); if (!body.success) return validationError(body.details);
    if (rawToken) { const redemption = await lifecycleRedemptionLimit(request, rawToken(body.data)); if (redemption) return redemption; }
    return await perform(actor, body.data);
  } catch (error) {
    return mapRouteError(error, {
      operation: "account.security_change",
      request,
      rules: [
        authenticationRule,
        staleSessionRule,
        routeErrorRule(AccountSecurityError, (denied) => forbidden(denied.message)),
        routeErrorRule(AccountTokenError, (invalid) => badRequest(invalid.message)),
        routeErrorRule(EmailChangeError, (invalid) => badRequest(invalid.message))
      ]
    });
  }
}
