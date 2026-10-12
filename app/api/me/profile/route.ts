import { NextResponse } from "next/server";
import {
  forbidden,
  mapRouteError,
  routeErrorRule,
  validationError
} from "@/lib/api/errors";
import {
  authenticationRule,
  organisationAccessRule,
  staleSessionRule
} from "@/lib/api/route-rules";
import { requireAccountRole } from "@/lib/auth/access";
import { updateAccountProfile } from "@/lib/auth/account-settings";
import { AccountSecurityError } from "@/lib/auth/account-lifecycle";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";
import { memberProfileSchema } from "@/lib/validators/auth";

export async function PATCH(request: Request) {
  const trustedOriginError = enforceTrustedMutationRequest(request);

  if (trustedOriginError) {
    return trustedOriginError;
  }

  const validation = await validateJson(request, memberProfileSchema);

  if (!validation.success) {
    return validationError(validation.details);
  }

  try {
    const user = await requireAccountRole("member");
    const updatedUser = await updateAccountProfile(user, validation.data);

    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    return mapRouteError(error, {
      operation: "account.profile_update",
      request,
      rules: [
        authenticationRule,
        staleSessionRule,
        organisationAccessRule,
        routeErrorRule(AccountSecurityError, (failure) => forbidden(failure.message))
      ]
    });
  }
}
