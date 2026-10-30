import { NextResponse } from "next/server";
import { mapRouteError, validationError } from "@/lib/api/errors";
import { requireAuthenticatedUser, requireCurrentOrganisationAccount, requireOrganisationEventManagementAccess } from "@/lib/auth/access";
import { eventRouteRules } from "@/lib/events/http";
import { createEventTicketCode } from "@/lib/events/ticket-codes";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";
import { ticketCodeSchema } from "@/lib/validators/events";

type RouteContext = { params: Promise<{ eventId: string }> };

// Body: { code, ticketTypeId, percentOff?, amountOff?, maxUses?, endsAt? }. A
// discount, access or comp code for the selected society's event.
export async function POST(request: Request, context: RouteContext) {
  const trustedOriginError = enforceTrustedMutationRequest(request);
  if (trustedOriginError) return trustedOriginError;
  const { eventId } = await context.params;

  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationEventManagementAccess(organisation.id);
    const actor = await requireAuthenticatedUser();
    const validation = await validateJson(request, ticketCodeSchema);
    if (!validation.success) return validationError(validation.details);
    const code = await createEventTicketCode(organisation.id, eventId, validation.data, actor.id);
    return NextResponse.json({ code }, { status: 201 });
  } catch (error) {
    return mapRouteError(error, { operation: "events.codes.create", request, rules: eventRouteRules(["x-org-id"]) });
  }
}
