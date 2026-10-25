import type { Prisma, TicketValidity } from "@prisma/client";
import { requireOrganisationPermission } from "@/lib/auth/access";
import { buyerIdentitySelect, retainedBuyerIdentity } from "@/lib/orders/buyer-identity";
import {
  ascendingCursorWhere,
  decodeTimestampCursor,
  defaultPageLimit,
  orderByForDirection,
  pageInfoForPage,
  type ParsedPaginationOptions
} from "@/lib/pagination/cursor";
import { purchasedTicketTypeLabel } from "@/lib/purchases/projection";
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

// A void or under-review ticket admits no one, and its attendance record is
// kept as it was: neither check-in nor undo applies (T19b).
export class TicketNotValidError extends Error {
  constructor(readonly validity: TicketValidity, readonly validityReason: string | null) {
    super(validity === "refund_review" ? "This ticket is under review" : "This ticket is no longer valid");
    this.name = "TicketNotValidError";
  }
}

export type OrganisationEventTicket = Awaited<ReturnType<typeof getOrganisationEventTickets>>["tickets"][number];

function buyerName(user: { firstName: string | null; lastName: string | null; displayName: string | null }) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return user.displayName ?? (fullName || null);
}

const personName = (user: { firstName: string | null; lastName: string | null; email: string } | null) =>
  user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email : null;

// Search by name, email, order or ticket reference. Every word of a name must
// match some name or email field; a reference matches anywhere in the id.
function searchWhere(query: string): Prisma.TicketWhereInput {
  const text = (value: string) => ({ contains: value, mode: "insensitive" as const });
  const words = query.split(/\s+/).filter(Boolean);
  return {
    OR: [
      { id: text(query) },
      { orderId: text(query) },
      {
        AND: words.map((word) => ({
          order: {
            OR: [
              { buyerEmailSnapshot: text(word) }, { buyerFirstNameSnapshot: text(word) }, { buyerLastNameSnapshot: text(word) },
              { buyerDisplayNameSnapshot: text(word) }, { guestIdentity: { email: text(word) } },
              { user: { OR: [{ email: text(word) }, { firstName: text(word) }, { lastName: text(word) }, { displayName: text(word) }] } }
            ]
          }
        }))
      }
    ]
  };
}

// The event's tickets for the check-in console. Without a search it lists the
// tickets that admit (oldest first, paged); a search of 2 or more characters
// also finds void and under-review tickets so staff can see why they don't.
export async function getOrganisationEventTickets(
  organisationId: string,
  eventId: string,
  { limit = defaultPageLimit, cursor, direction = "next", query }: Partial<ParsedPaginationOptions> & { query?: string } = {}
) {
  const authority = await requireOrganisationPermission(organisationId, "tickets:check_in");
  const publishedOnly = authority.staffRole === "check_in_staff" ? { status: "published" as const } : {};
  const event = await prisma.event.findFirst({
    where: { id: eventId, organisationId, ...publishedOnly },
    select: { id: true, title: true }
  });
  if (!event) throw new OrganisationEventTicketsAccessError();

  const search = query?.trim() ?? "";
  const scope = { eventId, event: { organisationId, ...publishedOnly } };
  const decoded = cursor ? decodeTimestampCursor("createdAt", cursor) : null;
  const [tickets, totalCount, checkedInCount] = await prisma.$transaction([
    prisma.ticket.findMany({
      // Both the search and the cursor are OR clauses, so they're ANDed rather than spread:
      // a spread let the cursor replace the search and later pages listed every ticket (T53).
      where: {
        ...scope,
        AND: [
          search.length >= 2 ? searchWhere(search) : { validity: "active" as const },
          ...(decoded ? [ascendingCursorWhere("createdAt", decoded, direction)] : [])
        ]
      },
      orderBy: orderByForDirection("createdAt", direction, "asc"),
      take: limit + 1,
      select: {
        id: true, createdAt: true, checkedInAt: true, issueSequence: true, validity: true, validityReason: true, validityChangedAt: true,
        ticketType: { select: { name: true } },
        order: {
          select: {
            id: true, quantity: true, purchasedTicketTypeName: true, guestIdentityId: true, ...buyerIdentitySelect,
            user: { select: { email: true, firstName: true, lastName: true, displayName: true } }
          }
        }
      }
    }),
    // Void and under-review tickets admit no one, so the counts leave them out.
    prisma.ticket.count({ where: { ...scope, validity: "active" } }),
    prisma.ticket.count({ where: { ...scope, validity: "active", checkedInAt: { not: null } } })
  ]);
  const page = pageInfoForPage({ items: tickets, limit, direction, cursor, timestampField: "createdAt" });

  // Who checked each ticket in: the latest check-in in the audit history.
  const checkedIn = page.items.filter((ticket) => ticket.checkedInAt).map((ticket) => ticket.id);
  const checkIns = checkedIn.length
    ? await prisma.auditLog.findMany({
        where: { organisationId, action: "ticket.checked_in", targetType: "Ticket", targetId: { in: checkedIn } },
        orderBy: { createdAt: "desc" },
        select: { targetId: true, actor: { select: { firstName: true, lastName: true, email: true } } }
      })
    : [];
  const checkedInBy = new Map<string, string | null>();
  for (const entry of checkIns) if (entry.targetId && !checkedInBy.has(entry.targetId)) checkedInBy.set(entry.targetId, personName(entry.actor));

  return {
    event,
    tickets: page.items.map((ticket) => {
      const buyer = retainedBuyerIdentity(ticket.order);
      return {
        id: ticket.id,
        status: ticket.checkedInAt ? ("checked-in" as const) : ("unused" as const),
        createdAt: ticket.createdAt,
        checkedInAt: ticket.checkedInAt,
        checkedInBy: checkedInBy.get(ticket.id) ?? null,
        validity: ticket.validity,
        validityReason: ticket.validityReason,
        validityChangedAt: ticket.validityChangedAt,
        issueSequence: ticket.issueSequence,
        orderQuantity: ticket.order.quantity,
        ticketTypeName: purchasedTicketTypeLabel(ticket.order.purchasedTicketTypeName, ticket.ticketType.name),
        orderId: ticket.order.id,
        guest: ticket.order.guestIdentityId !== null,
        buyerEmail: buyer?.email ?? null,
        buyerName: buyer ? buyerName(buyer) : null
      };
    }),
    pageInfo: page.pageInfo,
    counts: { total: totalCount, unused: totalCount - checkedInCount, checkedIn: checkedInCount }
  };
}

// Check in or undo one ticket of the society's events. The ticket must still
// admit (active); the conditional update means two staff at the door can't
// both admit the same ticket, and the loser is told it is already checked in.
async function setCheckIn(organisationId: string, ticketId: string, actorUserId: string, checkIn: boolean) {
  const authority = await requireOrganisationPermission(organisationId, "tickets:check_in");
  const scope = { id: ticketId, event: { organisationId, ...(authority.staffRole === "check_in_staff" ? { status: "published" as const } : {}) } };
  return prisma.$transaction(async (tx) => {
    const existing = await tx.ticket.findFirst({ where: scope, select: { checkedInAt: true, validity: true, validityReason: true } });
    if (!existing) throw new OrganisationTicketAccessError();
    if (existing.validity !== "active") throw new TicketNotValidError(existing.validity, existing.validityReason);
    const checkedInAt = checkIn ? new Date() : null;
    const updated = await tx.ticket.updateMany({
      where: { ...scope, validity: "active", checkedInAt: checkIn ? null : { not: null } },
      data: { checkedInAt }
    });
    if (updated.count === 0) {
      const current = await tx.ticket.findFirstOrThrow({ where: scope, select: { validity: true, validityReason: true } });
      if (current.validity !== "active") throw new TicketNotValidError(current.validity, current.validityReason);
      throw checkIn ? new TicketAlreadyCheckedInError() : new TicketNotCheckedInError();
    }
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: checkIn ? "ticket.checked_in" : "ticket.checked_out", targetType: "Ticket", targetId: ticketId } });
    return { id: ticketId, status: checkIn ? ("checked-in" as const) : ("unused" as const), checkedInAt };
  });
}

export const checkInOrganisationTicket = (organisationId: string, ticketId: string, actorUserId: string) =>
  setCheckIn(organisationId, ticketId, actorUserId, true);

export const checkOutOrganisationTicket = (organisationId: string, ticketId: string, actorUserId: string) =>
  setCheckIn(organisationId, ticketId, actorUserId, false);
