import { NextResponse } from "next/server";
import { forbidden, mapRouteError, notFound, routeErrorRule } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
import {
  OrganisationAccessError,
  getCurrentOrganisationAccount,
  requireAuthenticatedUser,
  requireCurrentOrganisationAccount,
  requireOrganisationPermission
} from "@/lib/auth/access";
import { getLiveSession } from "@/lib/auth/live-session";
import { getOrganisationCommerceOrder, getOwnCommerceOrder } from "@/lib/commerce/orders";
import { canOpenGuestCommerceOrder, guestSessionIdFrom, readGuestSession } from "@/lib/guest/guest-access";
import { MfaRequiredError } from "@/lib/security/staff-mfa";

type RouteContext = { params: Promise<{ orderId: string }> };

// One membership or merchandise order (T20). The buyer sees their own order;
// staff with orders:read see their current society's order with the buyer
// snapshot. A ticket order id, another member's order or another society's
// order is the same 404, so an id alone reveals nothing. A signed-out guest
// reads only a merchandise order bought in their checkout session (T27b) or
// named by the purchase link they opened.
export async function GET(request: Request, context: RouteContext) {
  try {
    const { orderId } = await context.params;
    const guestSessionId = guestSessionIdFrom(request);
    const guest = guestSessionId && !(await getLiveSession()) ? await readGuestSession(guestSessionId) : null;
    if (guest) {
      const order = (await canOpenGuestCommerceOrder(guest, orderId)) ? await getOwnCommerceOrder({ guestIdentityId: guest.guestIdentityId }, orderId) : null;
      return order ? NextResponse.json({ view: "buyer", order }, { headers: { "Cache-Control": "no-store" } }) : notFound("Order not found");
    }
    const user = await requireAuthenticatedUser();
    const own = await getOwnCommerceOrder({ userId: user.id }, orderId);
    if (own) return NextResponse.json({ view: "buyer", order: own }, { headers: { "Cache-Control": "no-store" } });

    if (await getCurrentOrganisationAccount()) {
      const organisation = await requireCurrentOrganisationAccount();
      const allowed = await requireOrganisationPermission(organisation.id, "orders:read").then(() => true, (error) => {
        if (error instanceof OrganisationAccessError) return false;
        throw error;
      });
      const order = allowed ? await getOrganisationCommerceOrder(organisation.id, orderId) : null;
      if (order) return NextResponse.json({ view: "finance", order }, { headers: { "Cache-Control": "no-store" } });
    }
    return notFound("Order not found");
  } catch (error) {
    return mapRouteError(error, {
      operation: "commerce.order.read",
      request,
      rules: [authenticationRule, staleSessionRule, routeErrorRule(MfaRequiredError, (failure) => forbidden(failure.message))]
    });
  }
}
