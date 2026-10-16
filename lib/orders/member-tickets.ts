import { prisma } from "@/lib/db";
import {
  decodeTimestampCursor,
  descendingCursorWhere,
  orderByForDirection,
  pageInfoForPage,
  type ParsedPaginationOptions
} from "@/lib/pagination/cursor";

// The caller's own paid orders with their issued tickets, newest first.
export async function getMemberTicketOrders(
  userId: string,
  { limit, cursor, direction }: ParsedPaginationOptions
) {
  const decodedCursor = cursor
    ? decodeTimestampCursor("createdAt", cursor)
    : null;
  const cursorWhere = decodedCursor
    ? descendingCursorWhere("createdAt", decodedCursor, direction)
    : {};
  const orders = await prisma.order.findMany({
    where: {
      userId,
      status: "paid",
      ...cursorWhere
    },
    orderBy: orderByForDirection("createdAt", direction, "desc"),
    take: limit + 1,
    select: {
      id: true,
      status: true,
      purchasedTicketTypeName: true,
      quantity: true,
      totalAmount: true,
      paymentKind: true,
      createdAt: true,
      paidAt: true,
      failedAt: true,
      failureReason: true,
      event: {
        select: {
          id: true,
          title: true,
          startTime: true,
          organisation: {
            select: {
              name: true,
              timeZone: true
            }
          }
        }
      },
      ticketType: {
        select: {
          name: true
        }
      },
      // Only units that still admit; void and under-review units are history, not tickets to show at the door.
      tickets: {
        where: { validity: "active" },
        select: {
          id: true,
          createdAt: true
        },
        orderBy: { issueSequence: "asc" }
      }
    }
  });

  return pageInfoForPage({
    items: orders,
    limit,
    direction,
    cursor,
    timestampField: "createdAt"
  });
}

// The caller's nearest paid orders for events that have not started yet.
export async function getUpcomingTicketOrders(userId: string, take = 3) {
  return prisma.order.findMany({
    where: {
      userId,
      status: "paid",
      event: { is: { startTime: { gte: new Date() } } }
    },
    orderBy: [{ event: { startTime: "asc" } }, { id: "asc" }],
    take,
    select: {
      id: true,
      quantity: true,
      purchasedTicketTypeName: true,
      ticketType: { select: { name: true } },
      event: {
        select: {
          id: true,
          title: true,
          startTime: true,
          location: true,
          organisation: { select: { name: true, timeZone: true } }
        }
      }
    }
  });
}

// One of the caller's own fulfilled orders, for the confirmation page; another
// member's order reads as missing.
export function getMemberTicketOrder(userId: string, eventId: string, orderId: string) {
  return prisma.order.findFirst({
    where: { id: orderId, eventId, userId, status: "paid" },
    select: {
      id: true,
      quantity: true,
      totalAmount: true,
      paymentKind: true,
      purchasedTicketTypeName: true,
      buyerEmailSnapshot: true,
      ticketType: { select: { name: true } },
      tickets: { where: { validity: "active" }, select: { id: true }, orderBy: { issueSequence: "asc" } }
    }
  });
}

// A guest's own order, any status, for /guest/orders. The caller has already
// checked that the guest session may open it.
export function getGuestOrder(orderId: string) {
  return prisma.order.findFirst({
    where: { id: orderId, guestIdentityId: { not: null } },
    select: {
      id: true,
      status: true,
      paymentKind: true,
      quantity: true,
      totalAmount: true,
      purchasedTicketTypeName: true,
      buyerEmailSnapshot: true,
      userId: true,
      ticketType: { select: { name: true } },
      tickets: { where: { validity: "active" }, select: { id: true }, orderBy: { issueSequence: "asc" } },
      event: {
        select: {
          id: true, title: true, startTime: true, endTime: true, location: true,
          organisation: { select: { name: true, timeZone: true, supportEmail: true, refundPolicy: true } }
        }
      }
    }
  });
}
