import { prisma } from "@/lib/db";

export class OrganisationEventTicketsAccessError extends Error {
  constructor(message = "Event not found or access denied") {
    super(message);
    this.name = "OrganisationEventTicketsAccessError";
  }
}

export class OrganisationTicketAccessError extends Error {
  constructor(message = "Ticket not found or access denied") {
    super(message);
    this.name = "OrganisationTicketAccessError";
  }
}

export class TicketAlreadyCheckedInError extends Error {
  constructor(message = "Ticket has already been checked in") {
    super(message);
    this.name = "TicketAlreadyCheckedInError";
  }
}

export class TicketNotCheckedInError extends Error {
  constructor(message = "Ticket is not checked in") {
    super(message);
    this.name = "TicketNotCheckedInError";
  }
}

export type OrganisationEventTicket = Awaited<
  ReturnType<typeof getOrganisationEventTickets>
>["tickets"][number];

export const defaultTicketPageLimit = 25;
export const maxTicketPageLimit = 100;

export class TicketPaginationError extends Error {
  constructor(message = "Invalid ticket pagination parameters") {
    super(message);
    this.name = "TicketPaginationError";
  }
}

type TicketCursor = {
  createdAt: Date;
  id: string;
};

type TicketPaginationOptions = {
  limit?: number;
  cursor?: string;
  direction?: "next" | "prev";
};

type ParsedTicketPaginationOptions = {
  limit: number;
  cursor?: string;
  direction: "next" | "prev";
};

function buyerName(user: {
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
}) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return user.displayName ?? (fullName || null);
}

function ticketStatus(checkedInAt: Date | null): "unused" | "checked-in" {
  return checkedInAt ? "checked-in" : "unused";
}

function encodeTicketCursor(ticket: { createdAt: Date; id: string }) {
  return Buffer.from(
    JSON.stringify({
      createdAt: ticket.createdAt.toISOString(),
      id: ticket.id
    })
  ).toString("base64url");
}

function decodeTicketCursor(cursor: string): TicketCursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };

    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") {
      throw new Error("Invalid cursor shape");
    }

    const createdAt = new Date(parsed.createdAt);

    if (Number.isNaN(createdAt.getTime()) || parsed.id.trim().length === 0) {
      throw new Error("Invalid cursor values");
    }

    return {
      createdAt,
      id: parsed.id
    };
  } catch {
    throw new TicketPaginationError("Invalid ticket cursor");
  }
}

export function parseTicketPaginationOptions(
  searchParams: URLSearchParams
): ParsedTicketPaginationOptions {
  const limitParam = searchParams.get("limit");
  const cursor = searchParams.get("cursor")?.trim() || undefined;
  const directionParam = searchParams.get("direction") ?? "next";

  if (directionParam !== "next" && directionParam !== "prev") {
    throw new TicketPaginationError("Invalid ticket pagination direction");
  }

  if (!limitParam) {
    return {
      limit: defaultTicketPageLimit,
      cursor,
      direction: directionParam as "next" | "prev"
    };
  }

  if (!/^\d+$/.test(limitParam)) {
    throw new TicketPaginationError("Invalid ticket page limit");
  }

  const limit = Number(limitParam);

  if (limit < 1 || limit > maxTicketPageLimit) {
    throw new TicketPaginationError("Invalid ticket page limit");
  }

  return {
    limit,
    cursor,
    direction: directionParam as "next" | "prev"
  };
}

export async function getOrganisationEventTickets(
  organisationId: string,
  eventId: string,
  {
    limit = defaultTicketPageLimit,
    cursor,
    direction = "next"
  }: TicketPaginationOptions = {}
) {
  const event = await prisma.event.findFirst({
    where: {
      id: eventId,
      organisationId
    },
    select: {
      id: true,
      title: true
    }
  });

  if (!event) {
    throw new OrganisationEventTicketsAccessError();
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > maxTicketPageLimit) {
    throw new TicketPaginationError("Invalid ticket page limit");
  }

  const decodedCursor = cursor ? decodeTicketCursor(cursor) : null;
  const cursorWhere = decodedCursor
    ? direction === "prev"
      ? {
          OR: [
            { createdAt: { lt: decodedCursor.createdAt } },
            {
              createdAt: decodedCursor.createdAt,
              id: { lt: decodedCursor.id }
            }
          ]
        }
      : {
          OR: [
            { createdAt: { gt: decodedCursor.createdAt } },
            {
              createdAt: decodedCursor.createdAt,
              id: { gt: decodedCursor.id }
            }
          ]
        }
    : {};
  const ticketWhere = {
      eventId,
      event: {
        organisationId
      },
      ...cursorWhere
    };

  const [tickets, totalCount, checkedInCount] = await prisma.$transaction([
    prisma.ticket.findMany({
      where: ticketWhere,
      orderBy:
        direction === "prev"
          ? [{ createdAt: "desc" }, { id: "desc" }]
          : [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: {
        id: true,
        createdAt: true,
        checkedInAt: true,
        ticketType: {
          select: {
            name: true
          }
        },
        order: {
          select: {
            id: true,
            user: {
              select: {
                email: true,
                firstName: true,
                lastName: true,
                displayName: true
              }
            }
          }
        }
      }
    }),
    prisma.ticket.count({
      where: {
        eventId,
        event: {
          organisationId
        }
      }
    }),
    prisma.ticket.count({
      where: {
        eventId,
        checkedInAt: {
          not: null
        },
        event: {
          organisationId
        }
      }
    })
  ]);

  const hasExtraTicket = tickets.length > limit;
  const pageTickets = tickets.slice(0, limit);
  const orderedTickets =
    direction === "prev" ? [...pageTickets].reverse() : pageTickets;
  const firstTicket = orderedTickets[0] ?? null;
  const lastTicket = orderedTickets[orderedTickets.length - 1] ?? null;
  const hasPreviousPage = direction === "prev" ? hasExtraTicket : Boolean(cursor);
  const hasNextPage = direction === "prev" ? Boolean(cursor) : hasExtraTicket;

  return {
    event,
    tickets: orderedTickets.map((ticket) => ({
      id: ticket.id,
      status: ticketStatus(ticket.checkedInAt),
      createdAt: ticket.createdAt,
      checkedInAt: ticket.checkedInAt,
      ticketTypeName: ticket.ticketType.name,
      orderId: ticket.order.id,
      buyerEmail: ticket.order.user?.email ?? null,
      buyerName: ticket.order.user ? buyerName(ticket.order.user) : null
    })),
    pageInfo: {
      limit,
      hasNextPage,
      hasPreviousPage,
      nextCursor: lastTicket && hasNextPage ? encodeTicketCursor(lastTicket) : null,
      previousCursor:
        firstTicket && hasPreviousPage ? encodeTicketCursor(firstTicket) : null
    },
    counts: {
      total: totalCount,
      unused: totalCount - checkedInCount,
      checkedIn: checkedInCount
    }
  };
}

export async function checkInOrganisationTicket(
  organisationId: string,
  ticketId: string
) {
  const existingTicket = await prisma.ticket.findFirst({
    where: {
      id: ticketId,
      event: {
        organisationId
      }
    },
    select: {
      id: true,
      checkedInAt: true
    }
  });

  if (!existingTicket) {
    throw new OrganisationTicketAccessError();
  }

  if (existingTicket.checkedInAt) {
    throw new TicketAlreadyCheckedInError();
  }

  const checkedInAt = new Date();
  const updated = await prisma.ticket.updateMany({
    where: {
      id: ticketId,
      event: {
        organisationId
      },
      checkedInAt: null
    },
    data: {
      checkedInAt
    }
  });

  if (updated.count === 0) {
    throw new TicketAlreadyCheckedInError();
  }

  const ticket = await prisma.ticket.findFirstOrThrow({
    where: {
      id: ticketId,
      event: {
        organisationId
      }
    },
    select: {
      id: true,
      checkedInAt: true
    }
  });

  return {
    id: ticket.id,
    status: ticketStatus(ticket.checkedInAt),
    checkedInAt: ticket.checkedInAt
  };
}

export async function checkOutOrganisationTicket(
  organisationId: string,
  ticketId: string
) {
  const existingTicket = await prisma.ticket.findFirst({
    where: {
      id: ticketId,
      event: {
        organisationId
      }
    },
    select: {
      id: true,
      checkedInAt: true
    }
  });

  if (!existingTicket) {
    throw new OrganisationTicketAccessError();
  }

  if (!existingTicket.checkedInAt) {
    throw new TicketNotCheckedInError();
  }

  const updated = await prisma.ticket.updateMany({
    where: {
      id: ticketId,
      event: {
        organisationId
      },
      checkedInAt: {
        not: null
      }
    },
    data: {
      checkedInAt: null
    }
  });

  if (updated.count === 0) {
    throw new TicketNotCheckedInError();
  }

  const ticket = await prisma.ticket.findFirstOrThrow({
    where: {
      id: ticketId,
      event: {
        organisationId
      }
    },
    select: {
      id: true,
      checkedInAt: true
    }
  });

  return {
    id: ticket.id,
    status: ticketStatus(ticket.checkedInAt),
    checkedInAt: ticket.checkedInAt
  };
}
