import type { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { failStalePreCheckoutOrders } from "@/lib/orders/stale-orders";

export const orderStatusFilters = [
  "all",
  "paid",
  "pending",
  "expired",
  "failed"
] as const;

export type OrderStatusFilter = (typeof orderStatusFilters)[number];

export function parseOrderStatusFilter(value: string | null): OrderStatusFilter {
  return orderStatusFilters.includes(value as OrderStatusFilter)
    ? (value as OrderStatusFilter)
    : "all";
}

export class OrganisationOrderEventAccessError extends Error {
  constructor(message = "Event not found or access denied") {
    super(message);
    this.name = "OrganisationOrderEventAccessError";
  }
}

export async function getGroupedOrganisationOrdersWithContext(
  organisationId: string,
  statusFilter: OrderStatusFilter = "all",
  eventId?: string
) {
  await failStalePreCheckoutOrders({ organisationId });

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
      organisationId,
      ...(eventId ? { eventId } : {}),
      ...(statusFilter === "all" ? {} : { status: statusFilter as OrderStatus })
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
  eventId?: string
) {
  const result = await getGroupedOrganisationOrdersWithContext(
    organisationId,
    statusFilter,
    eventId
  );

  return result.groups;
}
