import { NextResponse } from "next/server";
import { mapRouteError, validationError } from "@/lib/api/errors";
import {
  requireAuthenticatedUser,
  requireOrganisationEventManagementAccess
} from "@/lib/auth/access";
import { requireOrganisationId } from "@/lib/db/organisation-scope";
import {
  createOrganisationEvent,
  listOrganisationEvents
} from "@/lib/events/event-lifecycle";
import { eventRouteRules } from "@/lib/events/http";
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
    const actor = await requireAuthenticatedUser();

    const event = await createOrganisationEvent(organisationId, validation.data, actor.id);

    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    return mapRouteError(error, {
      operation: "events.create",
      request,
      rules: eventRouteRules(["organisationId", "x-org-id"])
    });
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
    return mapRouteError(error, {
      operation: "events.list",
      request,
      rules: eventRouteRules(["orgId", "x-org-id"])
    });
  }
}
