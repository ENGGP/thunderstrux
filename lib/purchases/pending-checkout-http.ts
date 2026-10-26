import { NextResponse } from "next/server";
import { apiError, forbidden, mapRouteError, notFound, routeErrorRule } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
import { requireAuthenticatedUser } from "@/lib/auth/access";
import { getLiveSession } from "@/lib/auth/live-session";
import { canOpenGuestCommerceOrder, canOpenGuestOrder, guestSessionIdFrom, readGuestSession } from "@/lib/guest/guest-access";
import { GUEST_CSRF_HEADER, verifyGuestCsrf } from "@/lib/guest/guest-csrf";
import { prisma } from "@/lib/db";
import { FreeCancellationError, releaseFreeRegistration } from "@/lib/payments/free-cancellation";
import { PendingCheckoutError, cancelPendingCheckout } from "@/lib/purchases/pending-checkout";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";

// Who may act on a purchase as its buyer: the member who bought it, or the
// guest session that may open it (with its CSRF token). Anyone else gets the
// same 404. Returns the response to send, or the buyer's user id (null for a guest).
async function authorizeBuyer(request: Request, kind: "ticket" | "commerce", orderId: string): Promise<{ response: NextResponse } | { response?: never; buyerUserId: string | null }> {
  const order = kind === "ticket"
    ? await prisma.order.findUnique({ where: { id: orderId }, select: { userId: true, guestIdentityId: true } })
    : await prisma.commerceOrder.findUnique({ where: { id: orderId }, select: { userId: true, guestIdentityId: true } });
  const sessionId = guestSessionIdFrom(request);
  if (sessionId && !(await getLiveSession())) {
    const guest = await readGuestSession(sessionId);
    if (guest && !verifyGuestCsrf(sessionId, request.headers.get(GUEST_CSRF_HEADER))) return { response: forbidden("Invalid CSRF token") };
    const allowed = Boolean(order?.guestIdentityId && guest && (kind === "ticket" ? await canOpenGuestOrder(guest, orderId) : await canOpenGuestCommerceOrder(guest, orderId)));
    return allowed ? { buyerUserId: null } : { response: notFound("Order not found") };
  }
  const user = await requireAuthenticatedUser();
  return order?.userId && order.userId === user.id ? { buyerUserId: user.id } : { response: notFound("Order not found") };
}

// POST .../cancel for a ticket or a membership/merchandise order (round E1).
// Only its buyer may cancel (above). 200 {status: "cancelled"} or {status:
// "paid"} when Stripe was paid in the meantime.
export async function cancelPendingCheckoutRoute(request: Request, kind: "ticket" | "commerce", orderId: string) {
  const guard = enforceTrustedMutationRequest(request); if (guard) return guard;
  try {
    const buyer = await authorizeBuyer(request, kind, orderId);
    if (buyer.response) return buyer.response;
    const limit = await enforceRateLimit({ policy: "checkout_create", request, keyParts: ["cancel", orderId] });
    if (limit) return limit;
    return NextResponse.json({ status: await cancelPendingCheckout({ kind, id: orderId }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapRouteError(error, {
      operation: "purchases.cancel_checkout",
      request,
      rules: [
        authenticationRule,
        staleSessionRule,
        routeErrorRule(PendingCheckoutError, (failure) => apiError("CONFLICT", failure.message, 409, [{ path: ["orderId"], message: failure.message, reason: failure.kind }]))
      ]
    });
  }
}

// POST /api/purchases/tickets/[orderId]/cancel-registration (EVT-005): the
// buyer releases their own free registration before the event starts, and
// the places go back on sale. The same buyer check as above. 200 {status:
// "cancelled" | "already_cancelled"}.
export async function releaseFreeRegistrationRoute(request: Request, orderId: string) {
  const guard = enforceTrustedMutationRequest(request); if (guard) return guard;
  try {
    const buyer = await authorizeBuyer(request, "ticket", orderId);
    if (buyer.response) return buyer.response;
    const limit = await enforceRateLimit({ policy: "checkout_create", request, keyParts: ["cancel-registration", orderId] });
    if (limit) return limit;
    const result = await releaseFreeRegistration({ orderId, buyerUserId: buyer.buyerUserId });
    return NextResponse.json({ status: result.status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapRouteError(error, {
      operation: "purchases.cancel_registration",
      request,
      rules: [
        authenticationRule,
        staleSessionRule,
        routeErrorRule(FreeCancellationError, (failure) =>
          failure.kind === "not_found" ? notFound("Order not found") : apiError("CONFLICT", failure.message, 409, [{ path: ["orderId"], message: failure.message, reason: failure.kind }])
        )
      ]
    });
  }
}
