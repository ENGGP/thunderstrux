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
