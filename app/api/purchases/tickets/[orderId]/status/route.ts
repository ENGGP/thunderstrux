import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { mapRouteError, notFound } from "@/lib/api/errors";
import { getLiveSession } from "@/lib/auth/live-session";
import { guestCookieName, readGuestSession } from "@/lib/guest/guest-access";
import { ticketOrderProjection } from "@/lib/purchases/projection";
import { getTicketPurchaseStatus, mayOpenTicketPurchase } from "@/lib/purchases/ticket-purchases";

type RouteContext = { params: Promise<{ orderId: string }> };

// The status of the caller's own ticket order, for the payment return page to
// poll (T19a). Only the member who bought it, or the guest session that may
// open it, gets an answer; everyone else gets the same 404.
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { orderId } = await context.params;
    const [order, live, guest] = await Promise.all([
      getTicketPurchaseStatus(orderId),
      getLiveSession(),
      cookies().then((jar) => readGuestSession(jar.get(guestCookieName)?.value))
    ]);
    if (!order || !(await mayOpenTicketPurchase(order, { userId: live?.user.id, guest }))) return notFound("Order not found");
    return NextResponse.json({ status: ticketOrderProjection(order) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapRouteError(error, { operation: "purchases.ticket_status", request: _request });
  }
}
