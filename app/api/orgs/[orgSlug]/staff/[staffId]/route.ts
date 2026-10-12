import { NextResponse } from "next/server";
import {
  conflict,
  forbidden,
  mapRouteError,
  notFound,
  routeErrorRule,
  unauthorized,
  validationError
} from "@/lib/api/errors";
import { authenticationRule, organisationAccessRule } from "@/lib/api/route-rules";
import {
  requireAuthenticatedUser,
  requireOrganisationPermission
} from "@/lib/auth/access";
import { organisationIdBySlug } from "@/lib/organisations/authority";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { StaffUpdateError, updateOrganisationStaff } from "@/lib/staff/management";
import { validateJson } from "@/lib/validators";
import { updateStaffSchema } from "@/lib/validators/staff";

type RouteContext = {
  params: Promise<{
    orgSlug: string;
    staffId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const trustedOriginError = enforceTrustedMutationRequest(request);

  if (trustedOriginError) {
    return trustedOriginError;
  }

  const validation = await validateJson(request, updateStaffSchema);

  if (!validation.success) {
    return validationError(validation.details);
  }

  const { orgSlug, staffId } = await context.params;

  try {
    const user = await requireAuthenticatedUser();
    const organisationId = await organisationIdBySlug(orgSlug);

    if (!organisationId) {
      return notFound("Organisation was not found");
    }

    await requireOrganisationPermission(organisationId, "staff:manage");

    const staff = await updateOrganisationStaff(user, organisationId, staffId, validation.data);

    return NextResponse.json({ staff });
  } catch (error) {
    return mapRouteError(error, {
      operation: "staff.update",
      request,
      rules: [
        routeErrorRule(StaffUpdateError, (failure) =>
          failure.kind === "not_found" ? notFound(failure.message)
            : failure.kind === "stale_session" ? unauthorized()
              : failure.kind === "conflict" ? conflict(failure.message)
                : forbidden(failure.message)
        ),
        authenticationRule,
        organisationAccessRule
      ]
    });
  }
}
