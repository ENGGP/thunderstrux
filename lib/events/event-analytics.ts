import { cache } from "react";
import { requireOrganisationPermission } from "@/lib/auth/access";
import { hasOrganisationPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db";

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
  const authority = await requireOrganisationPermission(organisationId, "analytics:read");
  const financial = hasOrganisationPermission(authority.staffRole, "orders:read");
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
            price: true,
            quantity: true
          },
          orderBy: { createdAt: "asc" }
        }
      }
    }),
    prisma.order.groupBy({
      // Free registrations count as sold tickets but never as revenue.
      by: ["ticketTypeId", "paymentKind"],
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
        ...(financial ? { totalAmount: true } : {})
      }
    })
  ]);

  if (!event) {
    throw new EventAnalyticsAccessError();
  }

  const ticketTypes = event.ticketTypes.map((ticketType) => {
    const groups = paidOrderGroups.filter((group) => group.ticketTypeId === ticketType.id);
    const paid = {
      sold: groups.reduce((total, group) => total + (group._sum.quantity ?? 0), 0),
      free: groups.reduce((total, group) => total + (group.paymentKind === "free" ? group._sum.quantity ?? 0 : 0), 0),
      revenue: financial
        ? groups.reduce((total, group) => total + (group.paymentKind === "stripe" ? group._sum.totalAmount ?? 0 : 0), 0)
        : null
    };

    return {
      id: ticketType.id,
      name: ticketType.name,
      price: ticketType.price,
      remaining: ticketType.quantity,
      sold: paid.sold,
      free: paid.free,
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
      revenue: financial ? ticketTypes.reduce((total, ticketType) => total + (ticketType.revenue ?? 0), 0) : null,
      sold: ticketTypes.reduce((total, ticketType) => total + ticketType.sold, 0),
      free: ticketTypes.reduce((total, ticketType) => total + ticketType.free, 0),
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
    await requireOrganisationPermission(organisationId, "orders:read");
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
          paymentKind: "stripe",
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
