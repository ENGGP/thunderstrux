import { prisma } from "@/lib/db";

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
      cancelledAt: true,
      cancelledByUserId: true,
      // What the order page needs to say a refund, dispute or review apart from a valid order (T44a).
      refundStatus: true,
      disputeStatus: true,
      requiresCompensationReview: true,
      externalRefundedAmount: true,
      externalRefundReviewedAt: true,
      refundRequests: { where: { status: "succeeded" }, orderBy: { createdAt: "desc" }, take: 1, select: { amount: true, resolvedAt: true } },
      ticketType: { select: { name: true } },
      tickets: { where: { validity: "active" }, select: { id: true, issueSequence: true }, orderBy: { issueSequence: "asc" } },
      event: {
        select: {
          id: true, title: true, startTime: true, endTime: true, location: true, cancelledAt: true,
          organisation: { select: { name: true, timeZone: true, supportEmail: true, refundPolicy: true } }
        }
      }
    }
  });
}
