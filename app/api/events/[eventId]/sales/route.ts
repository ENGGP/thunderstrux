import { NextResponse } from "next/server";
import { mapRouteError, validationError } from "@/lib/api/errors";
import {
  requireAuthenticatedUser,
  requireCurrentOrganisationAccount,
  requireOrganisationEventManagementAccess
} from "@/lib/auth/access";
import { setOrganisationEventSaleState } from "@/lib/events/event-lifecycle";
import { eventRouteRules } from "@/lib/events/http";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";
import { eventSaleStateSchema } from "@/lib/validators/events";

type RouteContext = {
  params: Promise<{
    eventId: string;
  }>;
};

// Body: { saleState: "open" | "closed", version }. Closing sales keeps the event
// published; repeating a request for the current state returns it unchanged.
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
    const validation = await validateJson(request, eventSaleStateSchema);

    if (!validation.success) {
      return validationError(validation.details);
    }

    const event = await setOrganisationEventSaleState(
      organisation.id,
      eventId,
      validation.data,
      actor.id
    );

    return NextResponse.json({ event });
  } catch (error) {
    return mapRouteError(error, {
      operation: "events.sales",
      request,
      rules: eventRouteRules(["x-org-id"])
    });
  }
}
