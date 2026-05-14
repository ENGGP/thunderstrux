import { prisma } from "@/lib/db";
import {
  ascendingCursorWhere,
  decodeTimestampCursor,
  orderByForDirection,
  pageInfoForPage,
  type PageInfo,
  type PaginationDirection
} from "@/lib/pagination/cursor";

export type PublicEventListItem = {
  id: string;
  title: string;
  startTime: Date;
  location: string;
  organisation: {
    name: string;
  };
};

export type PublicEventsPage = {
  events: PublicEventListItem[];
  pageInfo: PageInfo;
};

export type PublicEventTicketType = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  availableQuantity: number;
};

export type PublicEventDetail = {
  id: string;
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  location: string;
  organisation: {
    name: string;
    slug: string;
  };
  ticketTypes: PublicEventTicketType[];
};

export async function getPublishedEvents({
  limit = 25,
  cursor,
  direction = "next"
}: {
  limit?: number;
  cursor?: string;
  direction?: PaginationDirection;
} = {}): Promise<PublicEventsPage> {
  const decodedCursor = cursor ? decodeTimestampCursor("startTime", cursor) : null;
  const cursorWhere = decodedCursor
    ? ascendingCursorWhere("startTime", decodedCursor, direction)
    : {};
  const events = await prisma.event.findMany({
    where: {
      status: "published",
      ...cursorWhere
    },
    orderBy: orderByForDirection("startTime", direction, "asc"),
    take: limit + 1,
    select: {
      id: true,
      title: true,
      startTime: true,
      location: true,
      organisation: {
        select: {
          name: true
        }
      }
    }
  });

  const page = pageInfoForPage({
    items: events,
    limit,
    direction,
    cursor,
    timestampField: "startTime"
  });

  return {
    events: page.items,
    pageInfo: page.pageInfo
  };
}

export async function getPublishedEventDetail(
  eventId: string
): Promise<PublicEventDetail | null> {
  const event = await prisma.event.findFirst({
    where: {
      id: eventId,
      status: "published"
    },
    select: {
      id: true,
      title: true,
      description: true,
      startTime: true,
      endTime: true,
      location: true,
      organisation: {
        select: {
          name: true,
          slug: true
        }
      },
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
  });

  if (!event) {
    return null;
  }

  const ticketTypeIds = event.ticketTypes.map((ticketType) => ticketType.id);
  const now = new Date();
  const activeReservationSums =
    ticketTypeIds.length > 0
      ? await prisma.ticketReservation.groupBy({
          by: ["ticketTypeId"],
          where: {
            ticketTypeId: { in: ticketTypeIds },
            status: "active",
            expiresAt: { gt: now }
          },
          _sum: {
            quantity: true
          }
        })
      : [];

  const reservedByTicketTypeId = new Map(
    activeReservationSums.map((reservation) => [
      reservation.ticketTypeId,
      reservation._sum.quantity ?? 0
    ])
  );

  return {
    ...event,
    ticketTypes: event.ticketTypes.map((ticketType) => ({
      ...ticketType,
      availableQuantity: Math.max(
        0,
        ticketType.quantity - (reservedByTicketTypeId.get(ticketType.id) ?? 0)
      )
    }))
  };
}
