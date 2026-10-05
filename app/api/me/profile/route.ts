import { NextResponse } from "next/server";
import {
  forbidden,
  internalError,
  unauthorized,
  validationError
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireAccountRole
} from "@/lib/auth/access";
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
    if (error instanceof AuthenticationRequiredError || (error instanceof AccountSecurityError && error.kind === "stale_session")) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError || error instanceof AccountSecurityError) {
      return forbidden(error.message);
    }

    console.error("Failed to update member profile", error);
    return internalError();
  }
}
