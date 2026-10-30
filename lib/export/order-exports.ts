import type { CommerceKind } from "@prisma/client";
// The badge's own words, so a spreadsheet says what the screen says.
import { statusLabel } from "@/components/ui/status-badge";
import { listOrganisationCommerceOrders, type CommerceOrderFilter } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { toCsv } from "@/lib/export/csv";
import { orderReference, ticketReference } from "@/lib/format";
import { getGroupedOrganisationOrdersWithContext, type OrderStatusFilter, type OrganisationOrderQueryFilters } from "@/lib/orders/grouped-orders";
import { ticketOrderProjection } from "@/lib/purchases/projection";
import { getOrganisationEventTickets } from "@/lib/tickets/check-in";
import { toZonedInput } from "@/lib/zoned-time";

// Spreadsheet downloads of a society's orders and an event's attendees (UI-018):
// every row the screen's filters match, read through the same scoped readers in
// pages of 100. Times are in the society's zone; money is dollars with a Currency column.
export const exportRowLimit = 10_000;
const pageSize = 100;

export class ExportTooLargeError extends Error {
  constructor() {
    super(`More than ${exportRowLimit.toLocaleString("en-AU")} rows. Narrow the filters (a shorter date range) and download again.`);
  }
}

const when = (date: Date | null, timeZone: string) => (date ? toZonedInput(date, timeZone).replace("T", " ") : "");
const dollars = (cents: number) => (cents / 100).toFixed(2);
const pickupWords = { pending: "preparing", ready: "ready-to-collect", collected: "collected" } as const;

// Every page of a cursor reader, stopping past the row limit.
async function everyPage<Row>(read: (cursor?: string) => Promise<{ rows: Row[]; nextCursor: string | null }>) {
  const rows: Row[] = [];
  let cursor: string | undefined;
  do {
    const page = await read(cursor);
    rows.push(...page.rows);
    if (rows.length > exportRowLimit) throw new ExportTooLargeError();
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return rows;
}

export async function exportTicketOrders(organisationId: string, timeZone: string, status: OrderStatusFilter, eventId: string | undefined, filters: OrganisationOrderQueryFilters) {
  const orders = await everyPage(async (cursor) => {
    const page = await getGroupedOrganisationOrdersWithContext(organisationId, status, eventId, { ...filters, limit: pageSize, cursor, direction: "next" });
    return { rows: page.groups.flatMap((group) => group.orders.map((order) => ({ ...order, eventTitle: group.eventTitle }))), nextCursor: page.pageInfo.nextCursor };
  });
  orders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
  return {
    rows: orders.length,
    csv: toCsv(
      ["Order", "Ordered", "Event", "Ticket type", "Quantity", "Total", "Currency", "Code", "Discount", "Status", "Paid", "Buyer email"],
      orders.map((order) => [orderReference(order.id), when(order.createdAt, timeZone), order.eventTitle, order.ticketType, order.quantity, dollars(order.totalAmount), "AUD", order.code ?? "", order.code ? dollars(order.discountAmount) : "", statusLabel(order.projection), when(order.paidAt, timeZone), order.buyerEmail])
    )
  };
}

export async function exportCommerceOrders(
  organisationId: string,
  timeZone: string,
  kind: CommerceKind,
  options: { filter: CommerceOrderFilter; search?: string; productId?: string; startDate?: Date; endDate?: Date }
) {
  const orders = await everyPage(async (cursor) => {
    const page = await listOrganisationCommerceOrders(organisationId, kind, options, { limit: pageSize, cursor, direction: "next" });
    return { rows: page.items, nextCursor: page.pageInfo.nextCursor };
  });
  const merchandise = kind === "merchandise";
  const items = (lines: (typeof orders)[number]["lines"]) =>
    lines.map((line) => `${line.quantity > 1 ? `${line.quantity} × ` : ""}${line.nameSnapshot}${line.variantSnapshot ? ` (${line.variantSnapshot})` : ""}`).join("; ");
  return {
    rows: orders.length,
    csv: toCsv(
      ["Order", "Ordered", "Buyer", "Buyer email", "Guest", merchandise ? "Items" : "Plan", ...(merchandise ? [] : ["Starts", "Ends"]), "Total", "Currency", "Payment", ...(merchandise ? ["Pickup"] : [])],
      orders.map((order) => {
        const line = order.lines[0];
        return [
          orderReference(order.id), when(order.createdAt, timeZone), order.buyerNameSnapshot, order.buyerEmailSnapshot, order.guestIdentityId ? "Yes" : "No",
          merchandise ? items(order.lines) : line?.nameSnapshot ?? "",
          ...(merchandise ? [] : [line?.termStartsAt ? when(line.termStartsAt, timeZone).slice(0, 10) : "", line?.termEndsAt ? when(new Date(line.termEndsAt.getTime() - 1), timeZone).slice(0, 10) : ""]),
          dollars(order.totalAmount), order.currency.toUpperCase(), statusLabel(ticketOrderProjection(order)),
          ...(merchandise ? [order.pickupStatus ? statusLabel(pickupWords[order.pickupStatus]) : "No pickup"] : [])
        ];
      })
    )
  };
}

// The tickets that admit, as the Attendees tab lists them, for a printed door list or a backup.
export async function exportAttendees(organisationId: string, eventId: string, timeZone: string) {
  let title = "";
  const tickets = await everyPage(async (cursor) => {
    const page = await getOrganisationEventTickets(organisationId, eventId, { limit: pageSize, cursor, direction: "next" });
    title = page.event.title;
    return { rows: page.tickets, nextCursor: page.pageInfo.nextCursor };
  });
  return {
    rows: tickets.length,
    title,
    csv: toCsv(
      ["Ticket", "Name", "Email", "Guest", "Ticket type", "Ticket of order", "Order", "Checked in", "Checked in at", "Checked in by"],
      tickets.map((ticket) => [
        ticketReference(ticket.id), ticket.buyerName, ticket.buyerEmail, ticket.guest ? "Yes" : "No", ticket.ticketTypeName,
        `${ticket.issueSequence} of ${ticket.orderQuantity}`, orderReference(ticket.orderId), ticket.checkedInAt ? "Yes" : "No", when(ticket.checkedInAt, timeZone), ticket.checkedInBy
      ])
    )
  };
}

// Every download is audited: it takes buyer emails out of Thunderstrux.
export function recordExport(organisationId: string, actorUserId: string, action: "order.list_exported" | "order.attendees_exported", target: { type: string; id: string }, metadata: Record<string, unknown>) {
  return prisma.auditLog.create({ data: { organisationId, actorUserId, action, targetType: target.type, targetId: target.id, metadata: metadata as object } });
}

// A file name a spreadsheet keeps: the society, what it is and the day it was taken.
export function exportFileName(slug: string, what: string, timeZone: string) {
  return `${slug}-${what}-${toZonedInput(new Date(), timeZone).slice(0, 10)}.csv`.replace(/[^a-z0-9.-]+/gi, "-");
}
