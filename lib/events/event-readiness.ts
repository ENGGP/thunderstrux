import type { EventSaleState, EventStatus, EventVisibility } from "@prisma/client";

// Members-only events need the membership entitlements delivered by T24.
export const MEMBERS_ONLY_EVENTS_ENABLED = false;
// Checkout cannot issue zero-total orders until T13 adds free acquisition.
export const FREE_TICKETS_ENABLED = false;

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
export type TicketTypeUnavailableReason = "sold_out" | "payments_unavailable" | "free_unavailable";

export function salesOpen(event: Pick<ReadinessEvent, "saleState" | "salesCloseAt">, now = new Date()) {
  return event.saleState === "open" && now < event.salesCloseAt;
}

// The one place that decides whether an event may be published and which of its
// ticket types can be bought. Publication and per-type checkout eligibility are
// separate answers: once FREE_TICKETS_ENABLED, a mixed event may publish and sell
// its free tickets while its paid tickets wait for Stripe. `chargesReady` comes from the society's
// Connect state.
export function eventReadiness(
  event: ReadinessEvent,
  { chargesReady, now = new Date() }: { chargesReady: boolean; now?: Date }
) {
  const ticketTypes = event.ticketTypes.map((ticketType) => {
    const reason: TicketTypeUnavailableReason | null =
      (ticketType.sellable ?? ticketType.quantity) <= 0
        ? "sold_out"
        : ticketType.price <= 0 && !FREE_TICKETS_ENABLED
          ? "free_unavailable"
          : ticketType.price > 0 && !chargesReady
            ? "payments_unavailable"
            : null;
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
  if (event.visibility === "members_only" && !MEMBERS_ONLY_EVENTS_ENABLED) {
    block("members_only_unavailable", "visibility", "Members-only events become available with memberships.");
  }
  if (event.ticketTypes.length === 0) {
    block("no_ticket_types", "ticketTypes", "Add a ticket type before publishing.");
  } else if (event.ticketTypes.every((ticketType) => ticketType.quantity <= 0)) {
    block("no_stock", "ticketTypes", "Add ticket quantity before publishing.");
  } else if (!ticketTypes.some((ticketType) => ticketType.checkoutEligible)) {
    if (ticketTypes.some((ticketType) => ticketType.reason === "payments_unavailable")) {
      block("payments_unavailable", "ticketTypes", "Set up payments before publishing paid tickets.");
    } else {
      block("free_unavailable", "ticketTypes", "Free tickets are not available yet. Add a paid ticket type to publish this event.");
    }
  }

  return {
    publishable: blockers.length === 0,
    blockers,
    ticketTypes,
    salesOpen: event.status === "published" && salesOpen(event, now)
  };
}
