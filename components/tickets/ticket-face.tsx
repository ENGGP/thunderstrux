import Link from "next/link";
import type { TicketValidity } from "@prisma/client";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { ticketReference } from "@/lib/format";


// Whether a ticket admits, in words. Void tickets say why when the reason is known.
export function ticketState(ticket: { validity: TicketValidity; validityReason: string | null; checkedInAt: Date | null }, timeZone: string): { status: Status; label?: string } {
  if (ticket.validity === "refund_review") return { status: "under-review" };
  if (ticket.validity === "void") {
    if (ticket.validityReason === "refunded" || ticket.validityReason === "refunded_outside") return { status: "void", label: "Refunded" };
    if (ticket.validityReason === "cancelled") return { status: "void", label: "Cancelled" };
    return { status: "void" };
  }
  if (ticket.checkedInAt) {
    const time = new Intl.DateTimeFormat("en-AU", { timeStyle: "short", timeZone }).format(ticket.checkedInAt);
    return { status: "checked-in", label: `Checked in ${time}` };
  }
  return { status: "valid" };
}

// One ticket as the buyer shows it at the door: society, ticket type, which of
// the order's tickets it is, the short reference and whether it admits. No QR.
export function TicketFace({
  ticket,
  society,
  ticketType,
  of,
  free = false,
  timeZone,
  orderHref
}: {
  ticket: { id: string; issueSequence: number; validity: TicketValidity; validityReason: string | null; checkedInAt: Date | null };
  society: string;
  ticketType: string;
  of: number;
  free?: boolean;
  timeZone: string;
  orderHref?: string;
}) {
  const reference = ticketReference(ticket.id);
  const state = ticketState(ticket, timeZone);
  const admits = ticket.validity === "active";
  return (
    <article
      aria-label={`${ticketType}, ticket ${reference}, ${state.label ?? (state.status === "valid" ? "valid" : state.status.replace("-", " "))}`}
      className="flex flex-col overflow-hidden rounded-card border border-line bg-surface"
    >
      <div className="grid gap-1 p-4">
        <span className="text-sm font-semibold text-ink-soft">{society}</span>
        <strong className={`font-display text-[19px] font-semibold ${admits ? "text-ink" : "text-ink-soft"}`}>{ticketType}</strong>
        <span className="text-sm text-ink-soft">
          Ticket {ticket.issueSequence} of {of}{free ? " · Free" : ""}
          {orderHref ? <> · <Link className="font-semibold text-brand underline underline-offset-4" href={orderHref}>Purchase</Link></> : null}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 border-t-2 border-dashed border-line px-4 py-3">
        <span className={`font-mono text-xl font-bold tracking-[0.08em] ${admits ? "text-ink" : "text-ink-muted line-through"}`} title={ticket.id}>
          {reference}
        </span>
        <StatusBadge label={state.label} status={state.status} />
      </div>
      {ticket.validity === "refund_review" ? (
        <p className="px-4 pb-3.5 text-sm text-ink-soft">The payment is disputed. Contact {society} before the event.</p>
      ) : null}
    </article>
  );
}
