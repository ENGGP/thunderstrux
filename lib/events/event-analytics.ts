import { prisma } from "@/lib/db";

export class EventAnalyticsAccessError extends Error {
  constructor(message = "Event not found or access denied") {
    super(message);
    this.name = "EventAnalyticsAccessError";
  }
}

export async function getOrganisationEventAnalytics(
  organisationId: string,
  eventId: string
) {
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
        organisationId,
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
}
