import { NextResponse } from "next/server";
import {
  badRequest,
  forbidden,
  internalError,
  notFound,
  unauthorized
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireCurrentOrganisationAccount,
  requireOrganisationEventManagementAccess
} from "@/lib/auth/access";
import {
  EventLifecycleNotFoundError,
  EventLifecycleValidationError,
  toggleOrganisationEventPublished
} from "@/lib/events/event-lifecycle";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";

type RouteContext = {
  params: Promise<{
    eventId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const trustedOriginError = enforceTrustedMutationRequest(request);

  if (trustedOriginError) {
    return trustedOriginError;
  }

  const { eventId } = await context.params;

  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationEventManagementAccess(organisation.id);

    const event = await toggleOrganisationEventPublished(
      organisation.id,
      eventId
    );

    return NextResponse.json({ event });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    if (error instanceof EventLifecycleNotFoundError) {
      return notFound(error.message);
    }

    if (error instanceof EventLifecycleValidationError) {
      return badRequest(error.message, error.details);
    }

    console.error("Failed to toggle event publish status", { eventId, error });
    return internalError();
  }
}
