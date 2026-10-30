import { buyerIdentitySelect, retainedBuyerIdentity } from "@/lib/orders/buyer-identity";
import type { OrderStatus } from "@prisma/client";
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

export const orderStatusFilters = [
  "all",
  "paid",
  "expired",
  "failed"
] as const;

export const systemOrderStatusFilters = [
  ...orderStatusFilters,
  "pending"
] as const;

export type OrderStatusFilter = (typeof systemOrderStatusFilters)[number];

export function parseOrderStatusFilter(
  value: string | null,
  { includeSystemOrders = false }: { includeSystemOrders?: boolean } = {}
): OrderStatusFilter {
  const allowedFilters = includeSystemOrders
    ? systemOrderStatusFilters
    : orderStatusFilters;

  return allowedFilters.some((filter) => filter === value)
    ? (value as OrderStatusFilter)
    : "all";
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
  buyerEmail: string | null;
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
    where: {
      event: { organisationId },
      ...(eventId ? { eventId } : {}),
      ...(search
        ? {
            AND: [{ OR: [
              { buyerEmailSnapshot: { contains: search, mode: "insensitive" } },
              { buyerIdentityCapturedAt: null, user: { email: { contains: search, mode: "insensitive" } } }
            ] }]
          }
        : {}),
      ...(startDate || endDate
        ? {
            createdAt: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {})
            }
          }
        : {}),
      ...(statusFilter === "all"
        ? includeSystemOrders
          ? {}
          : { status: { in: ["paid", "expired", "failed"] as OrderStatus[] } }
        : { status: statusFilter as OrderStatus }),
      ...cursorWhere
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
          email: true
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
      buyerEmail: retainedBuyerIdentity(order)?.email ?? null
    });

    groups.set(order.eventId, group);
  }

  return {
    event: eventContext,
    groups: [...groups.values()],
    pageInfo
  };
}
