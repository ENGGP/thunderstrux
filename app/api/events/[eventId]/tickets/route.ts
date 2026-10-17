import { NextResponse } from "next/server";
import { mapRouteError } from "@/lib/api/errors";
import { requireCurrentOrganisationAccount, requireOrganisationPermission } from "@/lib/auth/access";
import { parsePaginationOptions } from "@/lib/pagination/cursor";
import { getOrganisationEventTickets } from "@/lib/tickets/check-in";
import { ticketRouteRules } from "@/lib/tickets/http";

type RouteContext = { params: Promise<{ eventId: string }> };

// The check-in console's ticket list and search (`q`: name, email, order or
// ticket reference, 2 to 100 characters).
export async function GET(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  try {
    const { searchParams } = new URL(request.url);
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationPermission(organisation.id, "tickets:check_in");
    const pagination = parsePaginationOptions(searchParams);
    const query = searchParams.get("q")?.slice(0, 100);
    const payload = await getOrganisationEventTickets(organisation.id, eventId, { ...pagination, query });
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapRouteError(error, { operation: "event.tickets.list", request, rules: ticketRouteRules });
  }
}
