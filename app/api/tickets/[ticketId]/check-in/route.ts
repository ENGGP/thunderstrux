import { NextResponse } from "next/server";
import { mapRouteError } from "@/lib/api/errors";
import { requireAuthenticatedUser, requireCurrentOrganisationAccount, requireOrganisationPermission } from "@/lib/auth/access";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { checkInOrganisationTicket } from "@/lib/tickets/check-in";
import { ticketRouteRules } from "@/lib/tickets/http";

type RouteContext = { params: Promise<{ ticketId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const trustedOriginError = enforceTrustedMutationRequest(request);
  if (trustedOriginError) return trustedOriginError;
  const { ticketId } = await context.params;
  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationPermission(organisation.id, "tickets:check_in");
    const limitResponse = await enforceRateLimit({ policy: "ticket_check_in_out", request, keyParts: [organisation.id, "check-in"] });
    if (limitResponse) return limitResponse;
    const actor = await requireAuthenticatedUser();
    const ticket = await checkInOrganisationTicket(organisation.id, ticketId, actor.id);
    return NextResponse.json({ ticket });
  } catch (error) {
    return mapRouteError(error, { operation: "ticket.check-in", request, rules: ticketRouteRules });
  }
}
