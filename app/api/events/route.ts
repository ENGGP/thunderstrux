import { NextResponse } from "next/server";
import {
  badRequest,
  forbidden,
  internalError,
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
  createOrganisationEvent,
  EventLifecycleValidationError,
  listOrganisationEvents
} from "@/lib/events/event-lifecycle";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";
import { createEventSchema } from "@/lib/validators/events";

export async function POST(request: Request) {
  const trustedOriginError = enforceTrustedMutationRequest(request);

  if (trustedOriginError) {
    return trustedOriginError;
  }

  const validation = await validateJson(request, createEventSchema);

  if (!validation.success) {
    return validationError(validation.details);
  }

  try {
    const organisationId = requireOrganisationId(validation.data.organisationId);
    await requireOrganisationEventManagementAccess(organisationId);

    const event = await createOrganisationEvent(organisationId, validation.data);

    return NextResponse.json({ event }, { status: 201 });
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

    if (error instanceof EventLifecycleValidationError) {
      return badRequest(error.message, error.details);
    }

    console.error(error);
    return internalError();
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const organisationId = requireOrganisationId(searchParams.get("orgId"));
    await requireOrganisationEventManagementAccess(organisationId);

    const events = await listOrganisationEvents(organisationId);

    return NextResponse.json({ events });
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

    console.error(error);
    return internalError();
  }
}
