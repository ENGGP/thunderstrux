import { NextResponse } from "next/server";
import { apiError, forbidden, mapRouteError, notFound, routeErrorRule } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
import { requireAuthenticatedUser } from "@/lib/auth/access";
import { getLiveSession } from "@/lib/auth/live-session";
import { canOpenGuestCommerceOrder, canOpenGuestOrder, guestSessionIdFrom, readGuestSession } from "@/lib/guest/guest-access";
import { GUEST_CSRF_HEADER, verifyGuestCsrf } from "@/lib/guest/guest-csrf";
import { prisma } from "@/lib/db";
import { PendingCheckoutError, cancelPendingCheckout } from "@/lib/purchases/pending-checkout";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";

// POST .../cancel for a ticket or a membership/merchandise order (round E1).
// Only the member who bought it, or the guest session that may open it (with
// its CSRF token), may cancel; anyone else gets the same 404. 200 {status:
// "cancelled"} or {status: "paid"} when Stripe was paid in the meantime.
export async function cancelPendingCheckoutRoute(request: Request, kind: "ticket" | "commerce", orderId: string) {
  const guard = enforceTrustedMutationRequest(request); if (guard) return guard;
  try {
    const order = kind === "ticket"
      ? await prisma.order.findUnique({ where: { id: orderId }, select: { userId: true, guestIdentityId: true } })
      : await prisma.commerceOrder.findUnique({ where: { id: orderId }, select: { userId: true, guestIdentityId: true } });
    const sessionId = guestSessionIdFrom(request);
    let allowed = false;
    if (sessionId && !(await getLiveSession())) {
      const guest = await readGuestSession(sessionId);
      if (guest && !verifyGuestCsrf(sessionId, request.headers.get(GUEST_CSRF_HEADER))) return forbidden("Invalid CSRF token");
      allowed = Boolean(order?.guestIdentityId && guest && (kind === "ticket" ? await canOpenGuestOrder(guest, orderId) : await canOpenGuestCommerceOrder(guest, orderId)));
    } else {
      const user = await requireAuthenticatedUser();
      allowed = Boolean(order?.userId && order.userId === user.id);
    }
    if (!allowed) return notFound("Order not found");
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
