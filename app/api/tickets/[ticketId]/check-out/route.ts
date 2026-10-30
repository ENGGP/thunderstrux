import { NextResponse } from "next/server";
import { badRequest, mapRouteError } from "@/lib/api/errors";
import { requireAuthenticatedUser, requireCurrentOrganisationAccount, requireOrganisationPermission } from "@/lib/auth/access";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { checkOutOrganisationTicket } from "@/lib/tickets/check-in";
import { ticketRouteRules } from "@/lib/tickets/http";

type RouteContext = { params: Promise<{ ticketId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const trustedOriginError = enforceTrustedMutationRequest(request);
  if (trustedOriginError) return trustedOriginError;
  const { ticketId } = await context.params;
  // DEBT-002: the event the door is checking; a ticket of another event isn't found.
  const eventId = new URL(request.url).searchParams.get("eventId");
  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationPermission(organisation.id, "tickets:check_in");
    const limitResponse = await enforceRateLimit({ policy: "ticket_check_in_out", request, keyParts: [organisation.id, "check-out"] });
    if (limitResponse) return limitResponse;
    const actor = await requireAuthenticatedUser();
    if (!eventId) return badRequest("Name the event", [{ path: ["eventId"], message: "Check tickets from an event's check-in page" }]);
    const ticket = await checkOutOrganisationTicket(organisation.id, eventId, ticketId, actor.id);
    return NextResponse.json({ ticket });
  } catch (error) {
    return mapRouteError(error, { operation: "ticket.check-out", request, rules: ticketRouteRules });
  }
}
