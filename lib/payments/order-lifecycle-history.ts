import type { OrderLifecycleEventType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { OrganisationOrderAccessError } from "@/lib/orders/order-detail";

export const orderLifecyclePageSize = 25;

export type OrderLifecycleDirection = "older" | "newer";

export function parseOrderLifecycleCursor(
  cursorValue?: string,
  directionValue?: string
) {
  const direction: OrderLifecycleDirection =
    directionValue === "newer" ? "newer" : "older";
  if (!cursorValue || !/^\d+$/.test(cursorValue)) {
    return { direction: "older" as const };
  }
  const cursor = Number(cursorValue);
  return Number.isSafeInteger(cursor) && cursor > 0
    ? { cursor, direction }
    : { direction: "older" as const };
}

export function orderLifecycleLabel(type: OrderLifecycleEventType) {
  const labels: Record<OrderLifecycleEventType, string> = {
    legacy_baseline: "Existing order state",
    order_created: "Order created",
    stripe_session_attached: "Stripe Checkout linked",
    order_failed: "Checkout failed",
    order_expired: "Checkout expired",
    compensation_required: "Payment needs compensation review",
    payment_fulfilled: "Payment fulfilled",
    compensation_recovered: "Fulfilment recovered",
    manual_refund_marked: "Marked as manually refunded",
    email_enqueued: "Ticket email queued",
    email_retry_scheduled: "Ticket email retry scheduled",
    email_provider_accepted: "Email provider accepted message",
    email_delivery_exhausted: "Ticket email retries exhausted"
  };
  return labels[type];
}

export async function getOrganisationOrderLifecycle(
  organisationId: string,
  orderId: string,
  {
    cursor,
    direction = "older"
  }: { cursor?: number; direction?: OrderLifecycleDirection } = {}
) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, event: { is: { organisationId } } },
    select: { id: true }
  });
  if (!order) throw new OrganisationOrderAccessError();

  const sequenceWhere = cursor
    ? direction === "newer"
      ? { gt: cursor }
      : { lt: cursor }
    : undefined;
  const rows = await prisma.orderLifecycleEvent.findMany({
    where: { orderId, sequence: sequenceWhere },
    orderBy: { sequence: direction === "newer" ? "asc" : "desc" },
    take: orderLifecyclePageSize,
    select: {
      id: true,
      sequence: true,
      type: true,
      source: true,
      reason: true,
      fromOrderStatus: true,
      toOrderStatus: true,
      fromReservationStatus: true,
      toReservationStatus: true,
      facts: true,
      createdAt: true,
      actor: {
        select: { displayName: true, firstName: true, lastName: true }
      }
    }
  });
  const events = direction === "newer" ? rows.reverse() : rows;
  const firstSequence = events[0]?.sequence;
  const lastSequence = events.at(-1)?.sequence;
  const [newerCount, olderCount, firstEvent] = await Promise.all([
    firstSequence
      ? prisma.orderLifecycleEvent.count({
          where: { orderId, sequence: { gt: firstSequence } }
        })
      : 0,
    lastSequence
      ? prisma.orderLifecycleEvent.count({
          where: { orderId, sequence: { lt: lastSequence } }
        })
      : 0,
    prisma.orderLifecycleEvent.findFirst({
      where: { orderId },
      orderBy: { sequence: "asc" },
      select: { type: true }
    })
  ]);

  return {
    events: events.map((event) => ({
      ...event,
      label: orderLifecycleLabel(event.type),
      actorName: event.actor
        ? event.actor.displayName ??
          ([event.actor.firstName, event.actor.lastName]
            .filter(Boolean)
            .join(" ") || "Staff user")
        : null
    })),
    historyIncomplete: !firstEvent || firstEvent.type !== "order_created",
    pageInfo: {
      newerCursor: newerCount > 0 ? firstSequence ?? null : null,
      olderCursor: olderCount > 0 ? lastSequence ?? null : null
    }
  };
}
