import type { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { runStaleOrderCleanup } from "@/lib/orders/stale-orders";
import {
  decodeTimestampCursor,
  descendingCursorWhere,
  orderByForDirection,
  pageInfoForPage,
  type PageInfo,
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
  ticketType: string;
  quantity: number;
  totalAmount: number;
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
  await runStaleOrderCleanup({ organisationId });

  const scopedEvents = eventId
    ? await prisma.event.findMany({
        where: {
          id: eventId,
          organisationId
        },
        select: {
          id: true,
          title: true
        }
      })
    : await prisma.event.findMany({
        where: {
          organisationId
        },
        select: {
          id: true,
          title: true
        }
      });
  const eventContext = eventId ? scopedEvents[0] ?? null : null;

  if (eventId && !eventContext) {
    throw new OrganisationOrderEventAccessError();
  }

  const decodedCursor = cursor
    ? decodeTimestampCursor("createdAt", cursor)
    : null;
  const cursorWhere = decodedCursor
    ? descendingCursorWhere("createdAt", decodedCursor, direction)
    : {};

  if (scopedEvents.length === 0) {
    return {
      event: eventContext,
      groups: [] as GroupedOrganisationOrderGroup[],
      pageInfo: emptyPageInfo(limit)
    };
  }

  const orders = await prisma.order.findMany({
    where: {
      eventId: {
        in: scopedEvents.map((event) => event.id)
      },
      ...(search
        ? {
            user: {
              email: {
                contains: search,
                mode: "insensitive"
              }
            }
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
      quantity: true,
      totalAmount: true,
      createdAt: true,
      paidAt: true,
      failedAt: true,
      failureReason: true,
      requiresCompensationReview: true,
      fulfilmentFailedAt: true,
      fulfilmentFailureReason: true,
      isManuallyRefunded: true,
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
  const eventTitles = new Map(scopedEvents.map((event) => [event.id, event.title]));

  const groups = new Map<string, GroupedOrganisationOrderGroup>();

  for (const order of pageOrders) {
    const eventTitle = eventTitles.get(order.eventId) ?? order.event.title;
    const group = groups.get(order.eventId) ?? {
      eventId: order.eventId,
      eventTitle,
      orders: []
    };

    group.orders.push({
      id: order.id,
      status: order.status,
      ticketType: order.ticketType.name,
      quantity: order.quantity,
      totalAmount: order.totalAmount,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      failedAt: order.failedAt,
      failureReason: order.failureReason,
      requiresCompensationReview: order.requiresCompensationReview,
      fulfilmentFailedAt: order.fulfilmentFailedAt,
      fulfilmentFailureReason: order.fulfilmentFailureReason,
      isManuallyRefunded: order.isManuallyRefunded,
      buyerEmail: order.user?.email ?? null
    });

    groups.set(order.eventId, group);
  }

  return {
    event: eventContext,
    groups: [...groups.values()],
    pageInfo
  };
}

export async function getGroupedOrganisationOrders(
  organisationId: string,
  statusFilter: OrderStatusFilter = "all",
  eventId?: string,
  filters: OrganisationOrderQueryFilters = {}
) {
  const result = await getGroupedOrganisationOrdersWithContext(
    organisationId,
    statusFilter,
    eventId,
    filters
  );

  return result.groups;
}

function emptyPageInfo(limit: number): PageInfo {
  return {
    limit,
    hasNextPage: false,
    hasPreviousPage: false,
    nextCursor: null,
    previousCursor: null
  };
}
