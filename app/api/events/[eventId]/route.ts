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
  requireCurrentOrganisationAccount,
  requireOrganisationEventManagementAccess
} from "@/lib/auth/access";
import {
  OrganisationMismatchError,
  OrganisationScopeError,
  requireOrganisationId
} from "@/lib/db/organisation-scope";
import {
  deleteOrganisationEvent,
  EventLifecycleNotFoundError,
  EventLifecycleValidationError,
  getOrganisationEvent,
  updateOrganisationEvent
} from "@/lib/events/event-lifecycle";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";
import { updateEventSchema } from "@/lib/validators/events";

type RouteContext = {
  params: Promise<{
    eventId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { eventId } = await context.params;

  try {
    const { searchParams } = new URL(request.url);
    const organisationId = requireOrganisationId(searchParams.get("orgId"));
    await requireOrganisationEventManagementAccess(organisationId);

    const event = await getOrganisationEvent(organisationId, eventId);

    return NextResponse.json({ event });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    if (error instanceof OrganisationScopeError) {
      return badRequest(error.message, [
        { path: ["orgId"], message: error.message },
        { path: ["x-org-id"], message: error.message }
      ]);
    }

    if (error instanceof EventLifecycleNotFoundError) {
      return notFound(error.message);
    }

    console.error("Failed to fetch event", { eventId, error });
    return internalError();
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const trustedOriginError = enforceTrustedMutationRequest(request);

  if (trustedOriginError) {
    return trustedOriginError;
  }

  const { eventId } = await context.params;

  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationEventManagementAccess(organisation.id);
    const validation = await validateJson(request, updateEventSchema);

    if (!validation.success) {
      return validationError(validation.details);
    }

    const submittedOrganisationId = requireOrganisationId(
      validation.data.organisationId
    );

    if (submittedOrganisationId !== organisation.id) {
      throw new OrganisationMismatchError(
        "organisationId does not match current organisation"
      );
    }

    const event = await updateOrganisationEvent(
      organisation.id,
      eventId,
      validation.data
    );

    return NextResponse.json({ event });
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
      return badRequest(error.message, [
        { path: ["organisationId"], message: error.message },
        { path: ["x-org-id"], message: error.message }
      ]);
    }

    if (error instanceof EventLifecycleNotFoundError) {
      return notFound(error.message);
    }

    if (error instanceof EventLifecycleValidationError) {
      return badRequest(error.message, error.details);
    }

    console.error("Failed to update event", { eventId, error });
    return internalError();
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const trustedOriginError = enforceTrustedMutationRequest(request);

  if (trustedOriginError) {
    return trustedOriginError;
  }

  const { eventId } = await context.params;

  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationEventManagementAccess(organisation.id);

    await deleteOrganisationEvent(organisation.id, eventId);

    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    if (error instanceof OrganisationScopeError) {
      return badRequest(error.message, [
        { path: ["x-org-id"], message: error.message }
      ]);
    }

    if (error instanceof EventLifecycleNotFoundError) {
      return notFound(error.message);
    }

    if (error instanceof EventLifecycleValidationError) {
      return badRequest(error.message, error.details);
    }

    console.error("Failed to delete event", { eventId, error });
    return internalError();
  }
}
