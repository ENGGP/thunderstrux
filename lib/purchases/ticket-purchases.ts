import type { OrderLifecycleEventType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canOpenGuestOrder, type GuestSession } from "@/lib/guest/guest-access";
import { abandonedWhere } from "@/lib/purchases/projection";
import {
  decodeTimestampCursor,
  descendingCursorWhere,
  orderByForDirection,
  pageInfoForPage,
  type ParsedPaginationOptions
} from "@/lib/pagination/cursor";

// A buyer's own ticket purchases (T19a). Every read is scoped to the buyer in
// the query itself: another member's order, or an order id alone, reads as
// missing.

// The facts ticketOrderProjection and buyerPurchaseBadge need.
const projectionSelect = {
  status: true,
  paymentKind: true,
  requiresCompensationReview: true,
  refundStatus: true,
  disputeStatus: true,
  externalRefundedAmount: true,
  externalRefundReviewedAt: true,
  cancelledAt: true,
  isManuallyRefunded: true
} satisfies Prisma.OrderSelect;

// Ticket orders also carry the manual-refund flag (compensation refunds set it too).
const abandonedOrderWhere = { ...abandonedWhere, isManuallyRefunded: false } satisfies Prisma.OrderWhereInput;

const listSelect = {
  id: true,
  ...projectionSelect,
  // Whether the buyer released it themselves (releasedByBuyer); member pages only.
  cancelledByUserId: true,
  userId: true,
  quantity: true,
  totalAmount: true,
  purchasedTicketTypeName: true,
  createdAt: true,
  ticketType: { select: { name: true } },
  event: { select: { id: true, title: true, organisation: { select: { name: true } } } }
} satisfies Prisma.OrderSelect;

// The member's ticket orders, newest first; checkouts that didn't complete only when asked.
export async function getOwnTicketPurchases(userId: string, { limit, cursor, direction }: ParsedPaginationOptions, { incomplete = false } = {}) {
  const decoded = cursor ? decodeTimestampCursor("createdAt", cursor) : null;
  const orders = await prisma.order.findMany({
    where: { userId, ...(incomplete ? {} : { NOT: abandonedOrderWhere }), ...(decoded ? descendingCursorWhere("createdAt", decoded, direction) : {}) },
    orderBy: orderByForDirection("createdAt", direction, "desc"),
    take: limit + 1,
    select: listSelect
  });
  return pageInfoForPage({ items: orders, limit, direction, cursor, timestampField: "createdAt" });
}

// What a buyer may see of an order's history: no staff names or reasons.
const buyerTimelineLabels: Partial<Record<OrderLifecycleEventType, string>> = {
  order_created: "Order placed",
  payment_fulfilled: "Payment confirmed",
  free_fulfilled: "Registration confirmed",
  compensation_required: "Payment received, tickets not issued",
  email_provider_accepted: "Tickets emailed",
  refund_requested: "Refund started",
  refunded: "Refunded",
  compensation_refunded: "Refunded",
  external_refund_recorded: "Refund recorded",
  dispute_opened: "Payment disputed",
  dispute_closed: "Dispute closed",
  dispute_resolved: "Tickets restored",
  free_cancelled: "Cancelled by the society",
  order_expired: "Checkout didn't complete"
};

// One of the member's own orders for /purchases/tickets/[orderId], with every
// ticket (valid or not) and a short buyer-safe history.
export async function getOwnTicketPurchase(userId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: {
      ...listSelect,
      paidAt: true,
      fulfilledAt: true,
      buyerEmailSnapshot: true,
      ticketEmailSentAt: true,
      event: {
        select: {
          id: true, title: true, startTime: true, endTime: true, location: true, cancelledAt: true,
          organisation: { select: { name: true, slug: true, timeZone: true, supportEmail: true, refundPolicy: true } }
        }
      },
      tickets: { orderBy: { issueSequence: "asc" }, select: { id: true, issueSequence: true, validity: true, validityReason: true, checkedInAt: true } },
      refundRequests: { where: { status: "succeeded" }, orderBy: { createdAt: "desc" }, take: 1, select: { amount: true, resolvedAt: true } }
    }
  });
  if (!order) return null;
  const history = await prisma.orderLifecycleEvent.findMany({
    where: { orderId, type: { in: Object.keys(buyerTimelineLabels) as OrderLifecycleEventType[] } },
    orderBy: { sequence: "desc" },
    take: 10,
    select: { id: true, type: true, source: true, reason: true, createdAt: true }
  });
  return {
    ...order,
    history: history.map((event) => ({
      id: event.id,
      label: event.type === "free_cancelled" && event.source === "buyer_action" ? "You cancelled your registration"
        // The dispute's reason is Stripe's status: "lost" means the buyer's bank returned the money.
        : event.type === "dispute_closed" && event.reason === "lost" ? "Refunded by your bank"
        : buyerTimelineLabels[event.type] as string,
      createdAt: event.createdAt
    }))
  };
}

// The order a member's Stripe return names, for /success. Only the member's own.
export function getOwnOrderForCheckoutSession(userId: string, stripeSessionId: string) {
  return prisma.order.findFirst({
    where: { stripeSessionId, userId },
    select: {
      id: true, ...projectionSelect, quantity: true, buyerEmailSnapshot: true, ticketEmailSentAt: true, fulfilledAt: true,
      event: { select: { id: true, title: true, organisation: { select: { name: true } } } }
    }
  });
}

// The projection facts behind GET /api/purchases/tickets/[orderId]/status.
// The route has already decided the caller may see this order.
export function getTicketPurchaseStatus(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, userId: true, guestIdentityId: true, quantity: true, ...projectionSelect, event: { select: { id: true, title: true, organisation: { select: { timeZone: true } } } } }
  });
}

// Whether this viewer bought the order: the member it belongs to, or a guest
// session allowed to open it. Anyone else is treated as if it doesn't exist.
export async function mayOpenTicketPurchase(
  order: { id: string; userId: string | null; guestIdentityId: string | null },
  viewer: { userId?: string | null; guest?: GuestSession | null }
) {
  if (order.userId && order.userId === viewer.userId) return true;
  return Boolean(order.guestIdentityId && viewer.guest && (await canOpenGuestOrder(viewer.guest, order.id)));
}

export type WalletView = "upcoming" | "past" | "not-valid";
export const walletViews: WalletView[] = ["upcoming", "past", "not-valid"];

// shortcut: each view shows the first 100 tickets; page with lib/pagination/cursor when members hold more.
const walletLimit = 100;

// The member's tickets from paid orders. Upcoming and Past hold tickets that
// still admit (checked in or not), split by whether the event has ended; Not
// valid holds void and under-review tickets, whatever the date.
function walletWhere(userId: string, view: WalletView, now: Date): Prisma.TicketWhereInput {
  const own = { order: { userId, status: "paid" as const } };
  if (view === "not-valid") return { ...own, validity: { not: "active" } };
  return { ...own, validity: "active", event: view === "upcoming" ? { endTime: { gt: now } } : { endTime: { lte: now } } };
}

export async function getWalletTickets(userId: string, view: WalletView, now = new Date()) {
  const [tickets, counts] = await Promise.all([
    prisma.ticket.findMany({
      where: walletWhere(userId, view, now),
      orderBy: [{ event: { startTime: view === "upcoming" ? "asc" : "desc" } }, { orderId: "asc" }, { issueSequence: "asc" }],
      take: walletLimit,
      select: {
        id: true, issueSequence: true, validity: true, validityReason: true, checkedInAt: true, orderId: true,
        order: { select: { quantity: true, paymentKind: true, purchasedTicketTypeName: true } },
        ticketType: { select: { name: true } },
        event: { select: { id: true, title: true, startTime: true, endTime: true, location: true, heroAssetId: true, organisation: { select: { name: true, timeZone: true } } } }
      }
    }),
    Promise.all(walletViews.map((item) => prisma.ticket.count({ where: walletWhere(userId, item, now) })))
  ]);
  return {
    tickets,
    truncated: tickets.length === walletLimit,
    counts: Object.fromEntries(walletViews.map((item, index) => [item, counts[index]])) as Record<WalletView, number>
  };
}

// How many purchases of each family the member has, for the Purchases tabs
// (T29a), and how many checkouts that didn't complete are hidden from each.
export async function ownPurchaseCounts(userId: string) {
  const [tickets, abandonedTickets, commerce, abandonedCommerce] = await Promise.all([
    prisma.order.count({ where: { userId, NOT: abandonedOrderWhere } }),
    prisma.order.count({ where: { userId, ...abandonedOrderWhere } }),
    prisma.commerceOrder.groupBy({ by: ["kind"], where: { userId, NOT: abandonedWhere }, _count: { _all: true } }),
    prisma.commerceOrder.groupBy({ by: ["kind"], where: { userId, ...abandonedWhere }, _count: { _all: true } })
  ]);
  const of = (rows: typeof commerce, kind: string) => rows.find((row) => row.kind === kind)?._count._all ?? 0;
  return {
    tickets, memberships: of(commerce, "membership"), merchandise: of(commerce, "merchandise"),
    abandoned: { tickets: abandonedTickets, memberships: of(abandonedCommerce, "membership"), merchandise: of(abandonedCommerce, "merchandise") }
  };
}
