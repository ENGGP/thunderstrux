import { NextResponse } from "next/server";
import { mapRouteError, validationError } from "@/lib/api/errors";
import {
  requireAuthenticatedUser,
  requireCurrentOrganisationAccount,
  requireOrganisationEventManagementAccess
} from "@/lib/auth/access";
import { setOrganisationEventPublication } from "@/lib/events/event-lifecycle";
import { eventRouteRules } from "@/lib/events/http";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";
import { eventPublicationSchema } from "@/lib/validators/events";

type RouteContext = {
  params: Promise<{
    eventId: string;
  }>;
};

// Body: { targetStatus: "published" | "draft", version }. Repeating a request
// for the status the event already has returns it unchanged.
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
    const validation = await validateJson(request, eventPublicationSchema);

    if (!validation.success) {
      return validationError(validation.details);
    }

    const event = await setOrganisationEventPublication(
      organisation.id,
      eventId,
      validation.data,
      actor.id
    );

    return NextResponse.json({ event });
  } catch (error) {
    return mapRouteError(error, {
      operation: "events.publication",
      request,
      rules: eventRouteRules(["x-org-id"])
    });
  }
}
