import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { failPendingCommerceOrder } from "@/lib/commerce/binding";
import { logWarn } from "@/lib/ops/logger";
import { reconcileExpiredCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import { getStripe } from "@/lib/stripe";
import { lateWebhookGraceMs } from "@/lib/tickets/reservations";

// Design round E1: an unpaid order says so, offers its Stripe payment page
// again while the hold lasts, and lets the buyer cancel. Stripe decides which:
// a Session it has been paid for is "confirming", never "waiting", and the
// hold alone never ends an order Stripe might still be paid on.

export type PendingCheckout =
  | { state: "waiting"; holdEndsAt: Date; paymentUrl: string | null }
  | { state: "confirming" }
  | { state: "ended" };

type Purchase = { kind: "ticket" | "commerce"; id: string };

// The Session and hold of an order still pending, or null once it isn't.
// `eventCancelled`: its event was cancelled (EVT-006), so nothing is paid any more.
export async function pendingCheckoutFacts({ kind, id }: Purchase) {
  if (kind === "ticket") {
    const order = await prisma.order.findUnique({ where: { id }, select: { status: true, stripeSessionId: true, reservation: { select: { expiresAt: true } }, event: { select: { cancelledAt: true } } } });
    // A reservation runs past the hold by the webhook margin; the buyer's deadline is the hold (PAY-009).
    const reservationEnds = order?.reservation?.expiresAt;
    return order?.status === "pending" ? { stripeSessionId: order.stripeSessionId, holdEndsAt: reservationEnds ? new Date(reservationEnds.getTime() - lateWebhookGraceMs) : null, eventCancelled: order.event.cancelledAt !== null } : null;
  }
  const order = await prisma.commerceOrder.findUnique({ where: { id }, select: { status: true, stripeSessionId: true, expiresAt: true } });
  return order?.status === "pending" ? { stripeSessionId: order.stripeSessionId, holdEndsAt: order.expiresAt, eventCancelled: false } : null;
}

export async function pendingCheckoutState(purchase: Purchase, now = new Date()): Promise<PendingCheckout | null> {
  const facts = await pendingCheckoutFacts(purchase);
  if (!facts) return null;
  // A cancelled event's unpaid order is never offered its payment page again.
  const held = facts.holdEndsAt && facts.holdEndsAt > now && !facts.eventCancelled ? facts.holdEndsAt : null;
  if (!facts.stripeSessionId) return held ? { state: "waiting", holdEndsAt: held, paymentUrl: null } : { state: "ended" };
  try {
    const session = await getStripe().checkout.sessions.retrieve(facts.stripeSessionId);
    if (session.status === "complete" || session.payment_status === "paid") return { state: "confirming" };
    if (session.status === "expired" || !held) return { state: "ended" };
    // The hold ends first: the stale-order job closes Stripe's page then.
    return { state: "waiting", holdEndsAt: held, paymentUrl: session.url ?? null };
  } catch (error) {
    // Without Stripe's answer, the hold decides; the payment page can't be offered.
    logWarn("checkout.pending_state_unavailable", { kind: purchase.kind, orderId: purchase.id, error });
    return held ? { state: "waiting", holdEndsAt: held, paymentUrl: null } : { state: "ended" };
  }
}

export class PendingCheckoutError extends Error {
  constructor(readonly kind: "not_pending" | "no_session") {
    super(kind === "no_session" ? "Stripe hasn't opened this payment yet. Try again in a minute." : "This order isn't waiting for payment any more.");
    this.name = "PendingCheckoutError";
  }
}

// The buyer cancels an unpaid order. Stripe closes its payment page first, so
// nothing can be paid after the hold is released; if Stripe was paid in the
// meantime, nothing is cancelled and the caller says it went through.
export async function cancelPendingCheckout(purchase: Purchase): Promise<"cancelled" | "paid"> {
  const facts = await pendingCheckoutFacts(purchase);
  if (!facts) throw new PendingCheckoutError("not_pending");
  if (!facts.stripeSessionId) throw new PendingCheckoutError("no_session");
  const stripe = getStripe();
  let session: Stripe.Checkout.Session = await stripe.checkout.sessions.retrieve(facts.stripeSessionId);
  if (session.status === "open") {
    try {
      session = await stripe.checkout.sessions.expire(session.id);
    } catch {
      // Paid or expired a moment ago: Stripe's current state decides.
      session = await stripe.checkout.sessions.retrieve(facts.stripeSessionId);
    }
  }
  if (session.status === "complete" || session.payment_status === "paid") return "paid";
  if (session.status !== "expired") throw new PendingCheckoutError("not_pending");
  if (purchase.kind === "ticket") await reconcileExpiredCheckoutSession(session, { source: "checkout" });
  else await failPendingCommerceOrder(purchase.id, "buyer_cancelled", "checkout", { status: "expired" });
  return "cancelled";
}

// Whether the buyer cancelled this order themselves (rather than the hold running out).
export async function cancelledByBuyer({ kind, id }: Purchase) {
  return kind === "ticket"
    ? Boolean(await prisma.orderLifecycleEvent.findFirst({ where: { orderId: id, type: "order_expired", source: "checkout" }, select: { id: true } }))
    : Boolean(await prisma.commerceLifecycleEvent.findFirst({ where: { commerceOrderId: id, type: "order_expired", source: "checkout" }, select: { id: true } }));
}
