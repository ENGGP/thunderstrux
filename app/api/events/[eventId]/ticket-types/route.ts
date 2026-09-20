import { NextResponse } from "next/server";
import {
  badRequest,
  forbidden,
  internalError,
  notFound,
  unauthorized,
  validationError
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireOrganisationEventManagementAccess
} from "@/lib/auth/access";
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
    const ticketType = await createOrganisationEventTicketType(
      organisationId,
      eventId,
      validation.data
    );

    return NextResponse.json({ ticketType }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    if (error instanceof OrganisationMismatchError) {
      return forbidden(error.message);
    }

    if (error instanceof OrganisationScopeError) {
      if (error.message === "organisationId is required for this operation") {
        return badRequest(error.message, [
          { path: ["organisationId"], message: error.message },
          { path: ["x-org-id"], message: error.message }
        ]);
      }

      return notFound(error.message);
    }

    if (error instanceof EventLifecycleNotFoundError) {
      return notFound(error.message);
    }

    console.error(error);
    return internalError();
  }
}
