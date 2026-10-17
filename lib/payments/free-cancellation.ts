import { prisma } from "@/lib/db";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import { appendOrderLifecycleEvent, lockOrder } from "@/lib/payments/order-lifecycle";

// Staff cancellation of a free purchase (T18c, readiness plan section 3.3).
// Nothing was charged, so this is never a refund: no refund rows or totals.
// The order keeps status paid and its original fulfilment; cancelledAt is the
// separate fact that read models show first. Tickets are voided with
// attendance kept, and stock is not restored (a separate reviewed action).
// T23 (membership grants) and T28 (pickups) follow the same shape.

export class FreeCancellationError extends Error {
  constructor(readonly kind: "not_found" | "not_cancellable", message: string) {
    super(message);
    this.name = "FreeCancellationError";
  }
}

export async function cancelFreePurchase(input: { organisationId: string; orderId: string; actor: { id: string }; reason: string }) {
  // The caller has verified the staff member's authenticator code (see the route).
  const reason = input.reason.trim();
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, input.orderId))) throw new FreeCancellationError("not_found", "Order was not found");
    const order = await tx.order.findFirst({
      where: { id: input.orderId, event: { organisationId: input.organisationId } },
      select: { paymentKind: true, status: true, fulfilledAt: true, cancelledAt: true, buyerEmailSnapshot: true, event: { select: { title: true } } }
    });
    if (!order) throw new FreeCancellationError("not_found", "Order was not found");
    // A replay of a cancellation that already happened changes nothing.
    if (order.cancelledAt) return { status: "already_cancelled" as const, cancelledAt: order.cancelledAt };
    if (order.paymentKind !== "free" || order.status !== "paid" || !order.fulfilledAt) {
      throw new FreeCancellationError("not_cancellable", "Only a confirmed free registration can be cancelled here");
    }
    await tx.order.update({ where: { id: input.orderId }, data: { cancelledAt: now, cancelledByUserId: input.actor.id, cancellationReason: reason } });
    const voided = await tx.ticket.updateMany({
      where: { orderId: input.orderId, validity: { not: "void" } },
      data: { validity: "void", validityReason: "cancelled", validityChangedAt: now }
    });
    await appendOrderLifecycleEvent(tx, {
      orderId: input.orderId, type: "free_cancelled", source: "staff_action", actorUserId: input.actor.id, reason, facts: { ticketCount: voided.count }
    });
    await tx.auditLog.create({ data: {
      organisationId: input.organisationId, actorUserId: input.actor.id, action: "order.free_cancelled", targetType: "Order", targetId: input.orderId,
      metadata: { reason, ticketCount: voided.count }
    } });
    if (order.buyerEmailSnapshot) {
      await enqueueNotification(tx, {
        eventKey: `cancellation/${input.orderId}`, recipient: order.buyerEmailSnapshot, template: "business_notice", organisationId: input.organisationId,
        payload: { message: `Your free registration for ${order.event.title} has been cancelled by the society. Nothing was charged, so there is nothing to refund. Your tickets are no longer valid.` }
      });
    }
    return { status: "cancelled" as const, cancelledAt: now };
  });
}
