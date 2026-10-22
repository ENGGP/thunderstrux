import { NextResponse } from "next/server";
import { badRequest, forbidden, mapRouteError, notFound, routeErrorRule, validationError } from "@/lib/api/errors";
import { authenticationRule } from "@/lib/api/route-rules";
import { OrganisationAccessError, requireAuthenticatedUser, requireOrganisationEventManagementAccess } from "@/lib/auth/access";
import {
  OrganisationMismatchError,
  OrganisationScopeError,
  requireOrganisationId
} from "@/lib/db/organisation-scope";
import {
  createOrganisationEventTicketType,
  EventLifecycleNotFoundError
} from "@/lib/events/event-lifecycle";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";
import { createScopedTicketTypeSchema } from "@/lib/validators/events";

type RouteContext = {
  params: Promise<{
    eventId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const trustedOriginError = enforceTrustedMutationRequest(request);

  if (trustedOriginError) {
    return trustedOriginError;
  }

  const { eventId } = await context.params;
  const validation = await validateJson(request, createScopedTicketTypeSchema);

  if (!validation.success) {
    return validationError(validation.details);
  }

  try {
    const organisationId = requireOrganisationId(validation.data.organisationId);
    await requireOrganisationEventManagementAccess(organisationId);
    const actor = await requireAuthenticatedUser();
    const ticketType = await createOrganisationEventTicketType(
      organisationId,
      eventId,
      validation.data,
      actor.id
    );

    return NextResponse.json({ ticketType }, { status: 201 });
  } catch (error) {
    return mapRouteError(error, {
      operation: "events.ticket_type_create",
      request,
      rules: [
        authenticationRule,
        routeErrorRule(OrganisationAccessError, (denied) => forbidden(denied.message)),
        routeErrorRule(OrganisationMismatchError, (denied) => forbidden(denied.message)),
        routeErrorRule(OrganisationScopeError, (scope) =>
          scope.message === "organisationId is required for this operation"
            ? badRequest(scope.message, [
                { path: ["organisationId"], message: scope.message },
                { path: ["x-org-id"], message: scope.message }
              ])
            : notFound(scope.message)
        ),
        routeErrorRule(EventLifecycleNotFoundError, (missing) => notFound(missing.message))
      ]
    });
  }
}
