import { NextResponse } from "next/server";
import { forbidden, mapRouteError, routeErrorRule, validationError } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
import { requireAuthenticatedUser } from "@/lib/auth/access";
import { notificationPreferencesSchema, updateNotificationPreferences } from "@/lib/auth/account-settings";
import { AccountSecurityError } from "@/lib/auth/account-lifecycle";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";

export async function PATCH(request: Request) {
  const trustedOriginError = enforceTrustedMutationRequest(request);
  if (trustedOriginError) return trustedOriginError;

  const validation = await validateJson(request, notificationPreferencesSchema);
  if (!validation.success) return validationError(validation.details);

  try {
    const user = await requireAuthenticatedUser();
    return NextResponse.json({ preferences: await updateNotificationPreferences(user, validation.data) });
  } catch (error) {
    return mapRouteError(error, {
      operation: "account.notification_preferences_update",
      request,
      rules: [authenticationRule, staleSessionRule, routeErrorRule(AccountSecurityError, (failure) => forbidden(failure.message))]
    });
  }
}
