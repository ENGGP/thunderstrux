import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import { lockEventInventory } from "@/lib/events/inventory";
import { appendOrderLifecycleEvent, lockOrder } from "@/lib/payments/order-lifecycle";

// Cancellation of a free purchase (T18c, readiness plan section 3.3).
// Nothing was charged, so this is never a refund: no refund rows or totals.
// The order keeps status paid and its original fulfilment; cancelledAt is the
// separate fact that read models show first. Tickets are voided with
// attendance kept. Staff cancellation doesn't restore stock; a buyer releasing
// their own registration does (EVT-005), so a capped event can sell the place again.
// T23 (membership grants) and T28 (pickups) follow the same shape.

export class FreeCancellationError extends Error {
  constructor(readonly kind: "not_found" | "not_cancellable" | "event_started", message: string) {
    super(message);
    this.name = "FreeCancellationError";
  }
}

type CancelledBy =
  // Staff on the order page: the buyer is told the society cancelled it.
  | { kind: "staff"; actorUserId: string }
  // Staff cancelling the whole event: its own notice tells the buyer (EVT-004).
  | { kind: "event"; actorUserId: string }
  // The buyer themselves; a guest has no user id.
  | { kind: "buyer"; actorUserId: string | null };

// One free order, inside the caller's transaction. Takes the order lock, so a
// caller that also locks the event takes that first (lib/events/inventory).
export async function cancelFreeOrder(
  tx: Prisma.TransactionClient,
  input: { organisationId: string; orderId: string; by: CancelledBy; reason: string; now: Date }
) {
  const reason = input.reason.trim();
  const { now, by } = input;
  if (!(await lockOrder(tx, input.orderId, input.organisationId))) throw new FreeCancellationError("not_found", "Order was not found");
  const order = await tx.order.findFirst({
    where: { id: input.orderId, event: { organisationId: input.organisationId } },
    select: { paymentKind: true, status: true, fulfilledAt: true, cancelledAt: true, buyerEmailSnapshot: true, event: { select: { title: true } } }
  });
  if (!order) throw new FreeCancellationError("not_found", "Order was not found");
  // A replay of a cancellation that already happened changes nothing.
  if (order.cancelledAt) return { status: "already_cancelled" as const, cancelledAt: order.cancelledAt, ticketCount: 0 };
  if (order.paymentKind !== "free" || order.status !== "paid" || !order.fulfilledAt) {
    throw new FreeCancellationError("not_cancellable", "Only a confirmed free registration can be cancelled here");
  }
  await tx.order.update({ where: { id: input.orderId }, data: { cancelledAt: now, cancelledByUserId: by.actorUserId, cancellationReason: reason } });
  const voided = await tx.ticket.updateMany({
    where: { orderId: input.orderId, validity: { not: "void" } },
    data: { validity: "void", validityReason: "cancelled", validityChangedAt: now }
  });
  await appendOrderLifecycleEvent(tx, {
    orderId: input.orderId, type: "free_cancelled", source: by.kind === "buyer" ? "buyer_action" : "staff_action", actorUserId: by.actorUserId, reason, facts: { ticketCount: voided.count }
  });
  await tx.auditLog.create({ data: {
    organisationId: input.organisationId, actorUserId: by.actorUserId, action: "order.free_cancelled", targetType: "Order", targetId: input.orderId,
    metadata: { reason, ticketCount: voided.count, by: by.kind }
  } });
  const message = by.kind === "staff"
    ? `Your free registration for ${order.event.title} has been cancelled by the society. Nothing was charged, so there is nothing to refund. Your tickets are no longer valid.`
    : by.kind === "buyer"
      ? `You cancelled your free registration for ${order.event.title}. Your place has gone back to the society for someone else, and your tickets are no longer valid.`
      : null;
  if (order.buyerEmailSnapshot && message) {
    await enqueueNotification(tx, {
      eventKey: `cancellation/${input.orderId}`, recipient: order.buyerEmailSnapshot, template: "business_notice", organisationId: input.organisationId,
      payload: { message }
    });
  }
  return { status: "cancelled" as const, cancelledAt: now, ticketCount: voided.count };
}

export async function cancelFreePurchase(input: { organisationId: string; orderId: string; actor: { id: string }; reason: string }) {
  // The caller has verified the staff member's authenticator code (see the route).
  const result = await prisma.$transaction((tx) =>
    cancelFreeOrder(tx, { organisationId: input.organisationId, orderId: input.orderId, by: { kind: "staff", actorUserId: input.actor.id }, reason: input.reason, now: new Date() })
  );
  return { status: result.status, cancelledAt: result.cancelledAt };
}

// The buyer releases their own free registration before the event starts
// (EVT-005). The caller has checked that this buyer may open the order. The
// places go back to the ticket type under the event lock, as checkout takes
// them, so the next buyer can register.
export async function releaseFreeRegistration(input: { orderId: string; buyerUserId: string | null }) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const found = await tx.order.findUnique({ where: { id: input.orderId }, select: { eventId: true, ticketTypeId: true, event: { select: { organisationId: true } } } });
    if (!found) throw new FreeCancellationError("not_found", "Order was not found");
    // Event, then ticket type, then order: the shared lock order.
    await lockEventInventory(tx, found.eventId, [found.ticketTypeId]);
    const event = await tx.event.findUniqueOrThrow({ where: { id: found.eventId }, select: { startTime: true, cancelledAt: true } });
    if (event.startTime <= now) throw new FreeCancellationError("event_started", "The event has started, so this registration can't be cancelled here. Contact the society.");
    const result = await cancelFreeOrder(tx, {
      organisationId: found.event.organisationId, orderId: input.orderId, by: { kind: "buyer", actorUserId: input.buyerUserId }, reason: "Cancelled by the buyer", now
    });
    // A cancelled event sells nothing again, so its places aren't returned.
    if (result.ticketCount > 0 && !event.cancelledAt) {
      await tx.ticketType.update({ where: { id: found.ticketTypeId }, data: { quantity: { increment: result.ticketCount } } });
    }
    return { status: result.status, cancelledAt: result.cancelledAt };
  });
}
