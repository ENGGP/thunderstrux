import { NextResponse } from "next/server";
import { mapRouteError, validationError } from "@/lib/api/errors";
import { requireAuthenticatedUser, requireCurrentOrganisationAccount, requireOrganisationEventManagementAccess } from "@/lib/auth/access";
import { eventRouteRules } from "@/lib/events/http";
import { updateEventTicketCode } from "@/lib/events/ticket-codes";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";
import { ticketCodeUpdateSchema } from "@/lib/validators/events";

type RouteContext = { params: Promise<{ eventId: string; codeId: string }> };

// Body: { maxUses?, endsAt?, disabled? }. A code's terms never change once made;
// staff turn it off instead of deleting it, so its orders keep their code.
export async function PATCH(request: Request, context: RouteContext) {
  const trustedOriginError = enforceTrustedMutationRequest(request);
  if (trustedOriginError) return trustedOriginError;
  const { eventId, codeId } = await context.params;

  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationEventManagementAccess(organisation.id);
    const actor = await requireAuthenticatedUser();
    const validation = await validateJson(request, ticketCodeUpdateSchema);
    if (!validation.success) return validationError(validation.details);
    const code = await updateEventTicketCode(organisation.id, eventId, codeId, validation.data, actor.id);
    return NextResponse.json({ code });
  } catch (error) {
    return mapRouteError(error, { operation: "events.codes.update", request, rules: eventRouteRules(["x-org-id"]) });
  }
}
