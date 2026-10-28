import { prisma } from "@/lib/db";
import {
  appendOrderLifecycleEvent,
  lockOrder
} from "@/lib/payments/order-lifecycle";
import { releaseReservationForOrder } from "@/lib/tickets/reservations";

// Failing and binding a checkout's order, shared by checkout and the recovery
// worker. Kept free of auth and request modules so workers can load it.

export class CheckoutCreationInternalError extends Error {
  constructor() {
    super("Checkout session creation failed");
    this.name = "CheckoutCreationInternalError";
  }
}

type CheckoutLifecycleSource = "checkout" | "checkout_recovery";

export async function failPendingOrder(
  orderId: string,
  message: string,
  source: CheckoutLifecycleSource = "checkout",
  attemptOutcome = "provider_failed"
) {
  await prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, orderId))) return;
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        status: true,
        requiresCompensationReview: true,
        reservation: { select: { status: true } }
      }
    });
    if (order.status !== "pending") return;

    const updated = await tx.order.updateMany({
      where: { id: orderId, status: "pending" },
      data: {
        status: "failed",
        failedAt: new Date(),
        failureReason: "stripe_error"
      }
    });
    if (updated.count === 0) return;

    await releaseReservationForOrder(tx, orderId, message);
    await tx.checkoutAttempt.updateMany({
      where: { orderId },
      data: { state: "failed", reconcileDueAt: null, lastOutcome: attemptOutcome }
    });
    await appendOrderLifecycleEvent(tx, {
      orderId,
      type: "order_failed",
      source,
      reason: "stripe_error",
      fromOrderStatus: "pending",
      toOrderStatus: "failed",
      fromReservationStatus: order.reservation?.status ?? null,
      toReservationStatus:
        order.reservation?.status === "active" ? "released" : order.reservation?.status,
      baseline: {
        orderStatus: order.status,
        reservationStatus: order.reservation?.status,
        compensationReview: order.requiresCompensationReview
      }
    });
  });
}

export async function attachStripeSession(
  orderId: string,
  stripeSessionId: string,
  stripeSessionUrl: string,
  source: CheckoutLifecycleSource = "checkout"
) {
  const outcome = await prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, orderId))) {
      throw new CheckoutCreationInternalError();
    }
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true, stripeSessionId: true, event: { select: { cancelledAt: true } } }
    });
    const attachAttempt = () =>
      tx.checkoutAttempt.updateMany({
        where: { orderId },
        data: { state: "provider_attached", stripeSessionId, stripeSessionUrl, reconcileDueAt: null, lastOutcome: "session_attached" }
      });

    // The webhook may have bound this Session first; converge on it.
    if (order.stripeSessionId === stripeSessionId) {
      await attachAttempt();
      return "attached" as const;
    }
    // PAY-032: an event cancelled while its Session was being created never gets
    // the page: the buyer isn't sent there, and the stale-order job expires the order.
    if (order.status !== "pending" || order.stripeSessionId || order.event.cancelledAt) {
      await tx.checkoutAttempt.updateMany({
        where: { orderId },
        // Keep the Session on record. A payment on it reaches compensation through the
        // webhook when the order closed; when the order holds another Session, it alerts a person (PAY-010).
        data: { state: "failed", stripeSessionId, stripeSessionUrl, reconcileDueAt: null, lastOutcome: order.event.cancelledAt ? "event_cancelled_at_attach" : "order_not_pending_at_attach" }
      });
      // Report it after the transaction commits, so this record is not rolled back.
      return "order_closed" as const;
    }

    const updated = await tx.order.updateMany({
      where: { id: orderId, status: "pending", stripeSessionId: null },
      data: { stripeSessionId }
    });
    if (updated.count === 0) throw new CheckoutCreationInternalError();
    await attachAttempt();

    await appendOrderLifecycleEvent(tx, {
      orderId,
      type: "stripe_session_attached",
      source,
      stripeSessionId,
      fromOrderStatus: "pending",
      toOrderStatus: "pending"
    });
    return "attached" as const;
  });

  if (outcome === "order_closed") throw new CheckoutCreationInternalError();
}
