import { cache } from "react";
import { prisma } from "@/lib/db";
import { failStalePreCheckoutOrders } from "@/lib/orders/stale-orders";

export class EventAnalyticsAccessError extends Error {
  constructor(message = "Event not found or access denied") {
    super(message);
    this.name = "EventAnalyticsAccessError";
  }
}

export const getOrganisationEventAnalytics = cache(async function getOrganisationEventAnalytics(
  organisationId: string,
  eventId: string
) {
  await failStalePreCheckoutOrders({ organisationId, eventId });

  const [event, paidOrderGroups] = await prisma.$transaction([
    prisma.event.findFirst({
      where: {
        id: eventId,
        organisationId
      },
      select: {
        id: true,
        title: true,
        description: true,
        startTime: true,
        endTime: true,
        location: true,
        status: true,
        ticketTypes: {
          select: {
            id: true,
            name: true,
            quantity: true
          },
          orderBy: { createdAt: "asc" }
        }
      }
    }),
    prisma.order.groupBy({
      by: ["ticketTypeId"],
      where: {
        eventId,
        event: {
          is: {
            organisationId
          }
        },
        status: "paid"
      },
      _sum: {
        quantity: true,
        totalAmount: true
      }
    })
  ]);

  if (!event) {
    throw new EventAnalyticsAccessError();
  }

  const paidOrdersByTicketType = new Map(
    paidOrderGroups.map((group) => [
      group.ticketTypeId,
      {
        sold: group._sum.quantity ?? 0,
        revenue: group._sum.totalAmount ?? 0
      }
    ])
  );

  const ticketTypes = event.ticketTypes.map((ticketType) => {
    const paid = paidOrdersByTicketType.get(ticketType.id) ?? {
      sold: 0,
      revenue: 0
    };

    return {
      id: ticketType.id,
      name: ticketType.name,
      remaining: ticketType.quantity,
      sold: paid.sold,
      revenue: paid.revenue
    };
  });

  return {
    event: {
      id: event.id,
      title: event.title,
      description: event.description,
      startTime: event.startTime,
      endTime: event.endTime,
      location: event.location,
      status: event.status
    },
    ticketTypes,
    totals: {
      revenue: ticketTypes.reduce((total, ticketType) => total + ticketType.revenue, 0),
      sold: ticketTypes.reduce((total, ticketType) => total + ticketType.sold, 0),
      remaining: ticketTypes.reduce(
        (total, ticketType) => total + ticketType.remaining,
        0
      )
    }
  };
});

export const getOrganisationEventRevenueSeries = cache(
  async function getOrganisationEventRevenueSeries(
    organisationId: string,
    eventId: string
  ) {
    await failStalePreCheckoutOrders({ organisationId, eventId });

    const [event, paidOrders] = await prisma.$transaction([
      prisma.event.findFirst({
        where: {
          id: eventId,
          organisationId
        },
        select: {
          id: true
        }
      }),
      prisma.order.findMany({
        where: {
          eventId,
          event: {
            is: {
              organisationId
            }
          },
          status: "paid",
          paidAt: {
            not: null
          }
        },
        select: {
          paidAt: true,
          totalAmount: true
        },
        orderBy: {
          paidAt: "asc"
        }
      })
    ]);

    if (!event) {
      throw new EventAnalyticsAccessError();
    }

    const buckets = new Map<string, number>();

    for (const order of paidOrders) {
      if (!order.paidAt) {
        continue;
      }

      const key = order.paidAt.toISOString().slice(0, 10);
      buckets.set(key, (buckets.get(key) ?? 0) + order.totalAmount);
    }

    return [...buckets.entries()].map(([date, revenue]) => ({
      date,
      revenue
    }));
  }
);
