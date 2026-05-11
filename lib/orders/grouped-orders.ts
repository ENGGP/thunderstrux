import type { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { runStaleOrderCleanup } from "@/lib/orders/stale-orders";

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
};

export async function getGroupedOrganisationOrdersWithContext(
  organisationId: string,
  statusFilter: OrderStatusFilter = "all",
  eventId?: string,
  {
    includeSystemOrders = false,
    search,
    startDate,
    endDate
  }: OrganisationOrderQueryFilters = {}
) {
  await runStaleOrderCleanup({ organisationId });

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

  const orders = await prisma.order.findMany({
    where: {
      event: {
        is: {
          organisationId
        }
      },
      ...(eventId ? { eventId } : {}),
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
        : { status: statusFilter as OrderStatus })
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      quantity: true,
      totalAmount: true,
      createdAt: true,
      paidAt: true,
      failedAt: true,
      failureReason: true,
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

  const groups = new Map<
    string,
    {
      eventId: string;
      eventTitle: string;
      orders: Array<{
        id: string;
        status: OrderStatus;
        ticketType: string;
        quantity: number;
        totalAmount: number;
        createdAt: Date;
        paidAt: Date | null;
        failedAt: Date | null;
        failureReason: string | null;
        isManuallyRefunded: boolean;
        buyerEmail: string | null;
      }>;
    }
  >();

  for (const order of orders) {
    const group = groups.get(order.event.id) ?? {
      eventId: order.event.id,
      eventTitle: order.event.title,
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
      isManuallyRefunded: order.isManuallyRefunded,
      buyerEmail: order.user?.email ?? null
    });

    groups.set(order.event.id, group);
  }

  return {
    event: eventContext,
    groups: [...groups.values()]
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
