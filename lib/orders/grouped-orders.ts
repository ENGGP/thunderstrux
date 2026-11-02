import { buyerIdentitySelect, retainedBuyerIdentity } from "@/lib/orders/buyer-identity";
import type { OrderDisputeStatus, OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  purchasedTicketTypeLabel,
  ticketOrderProjection,
  type TicketOrderProjection
} from "@/lib/purchases/projection";
import {
  decodeTimestampCursor,
  descendingCursorWhere,
  orderByForDirection,
  pageInfoForPage,
  type PaginationDirection
} from "@/lib/pagination/cursor";

// One pill per badge, in the projection's precedence (UI-065): every settled order
// is under exactly one, and Needs review is what waits on staff or the bank.
export const orderStatusFilters = [
  "all",
  "paid",
  "free",
  "refunded",
  "review",
  "expired"
] as const;

export const systemOrderStatusFilters = [
  ...orderStatusFilters,
  "pending"
] as const;

export type OrderStatusFilter = (typeof systemOrderStatusFilters)[number];

// The same pills on every family's Orders tab; only Needs review shows a count.
export const orderFilterLabels: Record<OrderStatusFilter, string> = { all: "All", paid: "Paid", free: "Free", refunded: "Refunded", review: "Needs review", expired: "Expired", pending: "Pending" };

export function parseOrderStatusFilter(
  value: string | null,
  { includeSystemOrders = false }: { includeSystemOrders?: boolean } = {}
): OrderStatusFilter {
  const allowedFilters = includeSystemOrders
    ? systemOrderStatusFilters
    : orderStatusFilters;

  // "failed" was its own filter once; failed checkouts now sit under Expired.
  const name = value === "failed" ? "expired" : value;
  return allowedFilters.some((filter) => filter === name)
    ? (name as OrderStatusFilter)
    : "all";
}

// Each mirrors ticketOrderProjection: a cancelled order is under All only, and a lost
// dispute is money the bank returned, so Refunded rather than a decision to make.
// Disputes use explicit ORs, because SQL drops NULL rows from NOT IN.
const unreviewedOutsideRefund = { externalRefundedAmount: { gt: 0 }, externalRefundReviewedAt: null } satisfies Prisma.OrderWhereInput;
const settled = {
  cancelledAt: null,
  disputeStatus: null,
  refundStatus: null,
  isManuallyRefunded: false,
  requiresCompensationReview: false,
  NOT: unreviewedOutsideRefund
} satisfies Prisma.OrderWhereInput;
const disputeWonOrNone = { OR: [{ disputeStatus: null }, { disputeStatus: "won" }] } satisfies Prisma.OrderWhereInput;
export const ticketReviewWhere = {
  cancelledAt: null,
  OR: [
    { disputeStatus: "open" },
    { AND: [disputeWonOrNone, { refundStatus: null, isManuallyRefunded: false }, { OR: [{ disputeStatus: "won" }, { requiresCompensationReview: true }, unreviewedOutsideRefund] }] }
  ]
} satisfies Prisma.OrderWhereInput;
const statusWhere: Record<Exclude<OrderStatusFilter, "all">, Prisma.OrderWhereInput> = {
  paid: { ...settled, status: "paid", paymentKind: "stripe" },
  free: { ...settled, status: "paid", paymentKind: "free" },
  refunded: {
    cancelledAt: null,
    OR: [{ disputeStatus: "lost" }, { AND: [disputeWonOrNone, { OR: [{ refundStatus: { not: null } }, { isManuallyRefunded: true }] }] }]
  },
  review: ticketReviewWhere,
  expired: { ...settled, status: { in: ["failed", "expired"] } },
  pending: { status: "pending" }
};

// Buyer name, email or the six-character order reference (UI-066). Each word of a
// full name ("Sam Lee") must match some name field, as check-in search does.
function orderSearchWhere(search: string): Prisma.OrderWhereInput {
  const buyerMatches = (text: string): Prisma.OrderWhereInput[] => {
    const contains = { contains: text, mode: "insensitive" as const };
    return [
      { buyerEmailSnapshot: contains },
      { buyerFirstNameSnapshot: contains },
      { buyerLastNameSnapshot: contains },
      { buyerDisplayNameSnapshot: contains },
      { buyerIdentityCapturedAt: null, user: { OR: [{ email: contains }, { firstName: contains }, { lastName: contains }, { displayName: contains }] } }
    ];
  };
  const words = search.split(/\s+/).filter(Boolean);
  return {
    OR: [
      ...buyerMatches(search),
      ...(words.length > 1 ? [{ AND: words.map((word) => ({ OR: buyerMatches(word) })) }] : []),
      ...(/^[a-z0-9]{6}$/i.test(search) ? [{ id: { endsWith: search.toLowerCase() } }] : [])
    ]
  };
}

export class OrganisationOrderEventAccessError extends Error {
  constructor(message = "Event not found or access denied") {
    super(message);
    this.name = "OrganisationOrderEventAccessError";
  }
}

export type OrganisationOrderQueryFilters = {
  includeSystemOrders?: boolean;
  search?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  cursor?: string;
  direction?: PaginationDirection;
};

export type GroupedOrganisationOrder = {
  id: string;
  status: OrderStatus;
  projection: TicketOrderProjection;
  ticketType: string;
  quantity: number;
  totalAmount: number;
  // The ticket code it was bought with, and what that took off the order.
  code: string | null;
  discountAmount: number;
  createdAt: Date;
  paidAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  requiresCompensationReview: boolean;
  fulfilmentFailedAt: Date | null;
  fulfilmentFailureReason: string | null;
  isManuallyRefunded: boolean;
  disputeStatus: OrderDisputeStatus | null;
  buyerEmail: string | null;
  buyerName: string | null;
};

export type GroupedOrganisationOrderGroup = {
  eventId: string;
  eventTitle: string;
  orders: GroupedOrganisationOrder[];
};

export async function getGroupedOrganisationOrdersWithContext(
  organisationId: string,
  statusFilter: OrderStatusFilter = "all",
  eventId?: string,
  {
    includeSystemOrders = false,
    search,
    startDate,
    endDate,
    limit = 25,
    cursor,
    direction = "next"
  }: OrganisationOrderQueryFilters = {}
) {
  const eventContext = eventId
    ? await prisma.event.findFirst({
        where: {
          id: eventId,
          organisationId
        },
        select: {
          id: true,
          title: true
        }
      })
    : null;

  if (eventId && !eventContext) {
    throw new OrganisationOrderEventAccessError();
  }

  const decodedCursor = cursor
    ? decodeTimestampCursor("createdAt", cursor)
    : null;
  const cursorWhere = decodedCursor
    ? descendingCursorWhere("createdAt", decodedCursor, direction)
    : {};

  const orders = await prisma.order.findMany({
    // One AND, so the search, status and cursor ORs never replace each other.
    where: {
      AND: [
        { event: { organisationId } },
        eventId ? { eventId } : {},
        search ? orderSearchWhere(search) : {},
        startDate || endDate
          ? { createdAt: { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}) } }
          : {},
        statusFilter === "all"
          ? includeSystemOrders
            ? {}
            : { status: { in: ["paid", "expired", "failed"] as OrderStatus[] } }
          : statusWhere[statusFilter],
        cursorWhere
      ]
    },
    orderBy: orderByForDirection("createdAt", direction, "desc"),
    take: limit + 1,
    select: {
      id: true,
      eventId: true,
      status: true,
      paymentKind: true,
      purchasedTicketTypeName: true,
      quantity: true,
      totalAmount: true,
      codeSnapshot: true,
      discountAmount: true,
      createdAt: true,
      paidAt: true,
      failedAt: true,
      failureReason: true,
      requiresCompensationReview: true,
      refundStatus: true,
      disputeStatus: true,
      externalRefundedAmount: true,
      externalRefundReviewedAt: true,
      cancelledAt: true,
      fulfilmentFailedAt: true,
      fulfilmentFailureReason: true,
      isManuallyRefunded: true,
      ...buyerIdentitySelect,
      user: {
        select: {
          email: true,
          firstName: true,
          lastName: true,
          displayName: true
        }
      },
      event: {
        select: {
          id: true,
          title: true
        }
      },
      ticketType: {
        select: {
          name: true
        }
      }
    }
  });
  const { items: pageOrders, pageInfo } = pageInfoForPage({
    items: orders,
    limit,
    direction,
    cursor,
    timestampField: "createdAt"
  });

  const groups = new Map<string, GroupedOrganisationOrderGroup>();

  for (const order of pageOrders) {
    const buyer = retainedBuyerIdentity(order);
    const group = groups.get(order.eventId) ?? {
      eventId: order.eventId,
      eventTitle: order.event.title,
      orders: []
    };

    group.orders.push({
      id: order.id,
      status: order.status,
      projection: ticketOrderProjection(order),
      ticketType: purchasedTicketTypeLabel(order.purchasedTicketTypeName, order.ticketType.name),
      quantity: order.quantity,
      totalAmount: order.totalAmount,
      code: order.codeSnapshot,
      discountAmount: order.discountAmount,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      failedAt: order.failedAt,
      failureReason: order.failureReason,
      requiresCompensationReview: order.requiresCompensationReview,
      fulfilmentFailedAt: order.fulfilmentFailedAt,
      fulfilmentFailureReason: order.fulfilmentFailureReason,
      isManuallyRefunded: order.isManuallyRefunded,
      disputeStatus: order.disputeStatus,
      buyerEmail: buyer?.email ?? null,
      buyerName: buyer ? buyer.displayName || [buyer.firstName, buyer.lastName].filter(Boolean).join(" ") || null : null
    });

    groups.set(order.eventId, group);
  }

  return {
    event: eventContext,
    groups: [...groups.values()],
    pageInfo
  };
}
