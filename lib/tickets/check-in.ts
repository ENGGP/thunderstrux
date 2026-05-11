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

export async function getOrganisationEventTickets(
  organisationId: string,
  eventId: string
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

  const tickets = await prisma.ticket.findMany({
    where: {
      eventId,
      event: {
        organisationId
      }
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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
  });

  return {
    event,
    tickets: tickets.map((ticket) => ({
      id: ticket.id,
      status: ticketStatus(ticket.checkedInAt),
      createdAt: ticket.createdAt,
      checkedInAt: ticket.checkedInAt,
      ticketTypeName: ticket.ticketType.name,
      orderId: ticket.order.id,
      buyerEmail: ticket.order.user?.email ?? null,
      buyerName: ticket.order.user ? buyerName(ticket.order.user) : null
    }))
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
