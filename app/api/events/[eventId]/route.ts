import { NextResponse } from "next/server";
import { mapRouteError, validationError } from "@/lib/api/errors";
import {
  requireAuthenticatedUser,
  requireCurrentOrganisationAccount,
  requireOrganisationEventManagementAccess
} from "@/lib/auth/access";
import {
  OrganisationMismatchError,
  requireOrganisationId
} from "@/lib/db/organisation-scope";
import {
  deleteOrganisationEvent,
  getOrganisationEvent,
  updateOrganisationEvent
} from "@/lib/events/event-lifecycle";
import { eventRouteRules } from "@/lib/events/http";
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
    return mapRouteError(error, {
      operation: "events.read",
      request,
      rules: eventRouteRules(["orgId", "x-org-id"])
    });
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
    const actor = await requireAuthenticatedUser();
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
      validation.data,
      actor.id
    );

    return NextResponse.json({ event });
  } catch (error) {
    return mapRouteError(error, {
      operation: "events.update",
      request,
      rules: eventRouteRules(["organisationId", "x-org-id"])
    });
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
    const actor = await requireAuthenticatedUser();

    await deleteOrganisationEvent(organisation.id, eventId, actor.id);

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return mapRouteError(error, {
      operation: "events.delete",
      request,
      rules: eventRouteRules(["x-org-id"])
    });
  }
}
