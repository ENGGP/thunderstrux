import { prisma } from "@/lib/db";
import {
  decodeTimestampCursor,
  descendingCursorWhere,
  orderByForDirection,
  pageInfoForPage,
  type ParsedPaginationOptions
} from "@/lib/pagination/cursor";

// The caller's own paid orders with their issued tickets, newest first.
export async function getMemberTicketOrders(
  userId: string,
  { limit, cursor, direction }: ParsedPaginationOptions
) {
  const decodedCursor = cursor
    ? decodeTimestampCursor("createdAt", cursor)
    : null;
  const cursorWhere = decodedCursor
    ? descendingCursorWhere("createdAt", decodedCursor, direction)
    : {};
  const orders = await prisma.order.findMany({
    where: {
      userId,
      status: "paid",
      ...cursorWhere
    },
    orderBy: orderByForDirection("createdAt", direction, "desc"),
    take: limit + 1,
    select: {
      id: true,
      status: true,
      quantity: true,
      totalAmount: true,
      createdAt: true,
      paidAt: true,
      failedAt: true,
      failureReason: true,
      event: {
        select: {
          id: true,
          title: true,
          startTime: true,
          organisation: {
            select: {
              name: true
            }
          }
        }
      },
      ticketType: {
        select: {
          name: true
        }
      },
      tickets: {
        select: {
          id: true,
          createdAt: true
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });

  return pageInfoForPage({
    items: orders,
    limit,
    direction,
    cursor,
    timestampField: "createdAt"
  });
}
