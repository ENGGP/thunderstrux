import type { EventSaleState, EventStatus, EventVisibility } from "@prisma/client";

export type ReadinessEvent = {
  title: string;
  description: string;
  location: string;
  startTime: Date;
  endTime: Date;
  salesCloseAt: Date;
  saleState: EventSaleState;
  status: EventStatus;
  visibility: EventVisibility;
  // `sellable` (from lib/events/inventory) also counts holds and capacity; without
  // it, stock is the remaining quantity.
  ticketTypes: Array<{ id: string; price: number; quantity: number; sellable?: number }>;
};

export type ReadinessBlocker = { code: string; field: string; message: string };
export type TicketTypeUnavailableReason = "sold_out" | "payments_unavailable";

export function salesOpen(event: Pick<ReadinessEvent, "saleState" | "salesCloseAt">, now = new Date()) {
  return event.saleState === "open" && now < event.salesCloseAt;
}

// Why one ticket type can't be bought now, or null when it can.
export function ticketTypeReason(ticketType: ReadinessEvent["ticketTypes"][number], chargesReady: boolean): TicketTypeUnavailableReason | null {
  if ((ticketType.sellable ?? ticketType.quantity) <= 0) return "sold_out";
  return ticketType.price > 0 && !chargesReady ? "payments_unavailable" : null;
}

// The one place that decides whether an event may be published and which of its
// ticket types can be bought. Publication and per-type checkout eligibility are
// separate answers: a mixed event may publish and sell its free tickets while its
// paid tickets wait for Stripe. `chargesReady` comes from the society's
// Connect state; `membersOnlyReady` says a published plan still to end unlocks
// members-only events (T24b), which a members-only event needs to publish.
export function eventReadiness(
  event: ReadinessEvent,
  { chargesReady, membersOnlyReady = false, now = new Date() }: { chargesReady: boolean; membersOnlyReady?: boolean; now?: Date }
) {
  const ticketTypes = event.ticketTypes.map((ticketType) => {
    const reason = ticketTypeReason(ticketType, chargesReady);
    return { id: ticketType.id, checkoutEligible: reason === null, reason };
  });
  const blockers: ReadinessBlocker[] = [];
  const block = (code: string, field: string, message: string) => blockers.push({ code, field, message });

  if (!event.title.trim() || !event.description.trim() || !event.location.trim()) {
    block("details_missing", "title", "Add a title, description and location before publishing.");
  }
  if (event.endTime <= event.startTime) {
    block("schedule_invalid", "endTime", "The event must end after it starts.");
  }
  if (event.salesCloseAt > event.endTime) {
    block("sales_close_after_end", "salesCloseAt", "Ticket sales must close before the event ends.");
  }
  if (event.salesCloseAt <= now) {
    block("sales_window_past", "salesCloseAt", "Move the sales close time into the future before publishing.");
  }
  if (event.visibility === "members_only" && !membersOnlyReady) {
    block("members_only_unavailable", "visibility", "Publish a membership plan that unlocks members-only events first.");
  }
  if (event.ticketTypes.length === 0) {
    block("no_ticket_types", "ticketTypes", "Add a ticket type before publishing.");
  } else if (event.ticketTypes.every((ticketType) => ticketType.quantity <= 0)) {
    block("no_stock", "ticketTypes", "Add ticket quantity before publishing.");
  } else if (!ticketTypes.some((ticketType) => ticketType.checkoutEligible)) {
    if (ticketTypes.some((ticketType) => ticketType.reason === "payments_unavailable")) {
      block("payments_unavailable", "ticketTypes", "Set up payments before publishing paid tickets.");
    } else {
      block("sold_out", "ticketTypes", "Every ticket type is sold out or held in checkouts.");
    }
  }
  // Not a blocker: a mixed event sells its free tickets, but the organiser should
  // know buyers see its paid ones as unavailable until payments are set up.
  const warnings: ReadinessBlocker[] =
    ticketTypes.some((ticketType) => ticketType.checkoutEligible) && ticketTypes.some((ticketType) => ticketType.reason === "payments_unavailable")
      ? [{ code: "paid_tickets_waiting", field: "ticketTypes", message: "Paid tickets can't be bought until payments are set up. Free tickets are on sale." }]
      : [];

  return {
    publishable: blockers.length === 0,
    blockers,
    warnings,
    ticketTypes,
    salesOpen: event.status === "published" && salesOpen(event, now)
  };
}
