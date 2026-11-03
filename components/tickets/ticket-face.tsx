import Link from "next/link";
import type { TicketValidity } from "@prisma/client";
import { renderSVG } from "uqr";
import { Icon, type IconName } from "@/components/ui/icon";
import { statusLabel, type Status } from "@/components/ui/status-badge";
import { formatClock, ticketReference } from "@/lib/format";

// The QR code holds only the ticket id, which the door's scanner sends to the
// staff-only check-in route. Dark on white, with a full quiet zone, so it scans in dark mode too.
const qrSource = (ticketId: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSVG(ticketId, { ecc: "M", border: 4, whiteColor: "#ffffff", blackColor: "#000000" }))}`;

// Whether a ticket admits, in words. Void tickets say why when the reason is known.
export function ticketState(ticket: { validity: TicketValidity; validityReason: string | null; checkedInAt: Date | null }, timeZone: string): { status: Status; label?: string } {
  if (ticket.validity === "refund_review") return { status: "under-review" };
  if (ticket.validity === "void") {
    if (ticket.validityReason === "refunded" || ticket.validityReason === "refunded_outside") return { status: "void", label: "Refunded" };
    if (ticket.validityReason === "cancelled") return { status: "void", label: "Cancelled" };
    return { status: "void" };
  }
  if (ticket.checkedInAt) {
    const time = formatClock(ticket.checkedInAt, timeZone);
    return { status: "checked-in", label: `Checked in ${time}` };
  }
  return { status: "valid" };
}

// The band across the top of a ticket: night while it admits, else the wash of its state.
const bands: Record<string, { box: string; word: string; icon: string; name: IconName }> = {
  admits: { box: "bg-night text-white", word: "text-white", icon: "text-glow", name: "success" },
  "checked-in": { box: "border-b border-success-border bg-success-bg text-ink", word: "text-success", icon: "text-success-icon", name: "success" },
  "under-review": { box: "border-b border-warning-border bg-warning-bg text-ink", word: "text-warning", icon: "text-warning-icon", name: "warning" },
  void: { box: "border-b border-danger-border bg-danger-bg text-ink", word: "text-danger", icon: "text-danger-icon", name: "error" },
  ended: { box: "border-b border-neutral-border bg-neutral-bg text-ink", word: "text-neutral", icon: "text-neutral-icon", name: "dash" }
};

// One ticket as the buyer shows it at the door: a band with the event and whether it
// admits, then society, ticket type, which of the order's tickets it is, a QR code
// while it admits (or when it was used), and the short reference.
export function TicketFace({
  ticket,
  event,
  society,
  ticketType,
  of,
  free = false,
  timeZone,
  orderHref,
  ended = false
}: {
  ticket: { id: string; issueSequence: number; validity: TicketValidity; validityReason: string | null; checkedInAt: Date | null };
  event: string;
  society: string;
  ticketType: string;
  of: number;
  free?: boolean;
  timeZone: string;
  orderHref?: string;
  // The event is over: a ticket nobody used reads Event ended, not a green Valid, and shows no code.
  ended?: boolean;
}) {
  const reference = ticketReference(ticket.id);
  const state = ended && ticket.validity === "active" && !ticket.checkedInAt ? { status: "ended" as const, label: "Event ended" } : ticketState(ticket, timeZone);
  const admits = ticket.validity === "active" && !ended;
  // A used ticket shows when it was used: its code would only get a STOP at the door.
  const used = admits && ticket.checkedInAt ? formatClock(ticket.checkedInAt, timeZone) : null;
  const band = bands[admits && !used ? "admits" : state.status in bands ? state.status : "ended"];
  return (
    <article
      aria-label={`${ticketType}, ticket ${reference}, ${state.label ?? (state.status === "valid" ? "valid" : state.status.replace("-", " "))}`}
      className="flex flex-col overflow-hidden rounded-card border border-line bg-surface"
    >
      <div className={`flex items-center justify-between gap-3 px-4 py-3 ${band.box}`}>
        <strong className="min-w-0 font-display text-[17px] font-semibold leading-snug [overflow-wrap:anywhere]">{event}</strong>
        <span className={`inline-flex shrink-0 items-center gap-1.5 text-sm font-bold ${band.word}`}>
          <Icon className={band.icon} name={band.name} size={18} />
          {state.label ?? statusLabel(state.status)}
        </span>
      </div>
      <div className="grid gap-1 p-4">
        <span className="text-sm font-semibold text-ink-soft">{society}</span>
        <strong className={`font-display text-[19px] font-semibold ${admits ? "text-ink" : "text-ink-soft"}`}>{ticketType}</strong>
        <span className="text-sm text-ink-soft">
          Ticket {ticket.issueSequence} of {of}{free ? " · Free" : ""}
          {orderHref ? <> · <Link className="font-semibold text-brand underline underline-offset-4" href={orderHref}>Purchase</Link></> : null}
        </span>
      </div>
      {used ? (
        <p className="mx-4 mb-4 rounded-control bg-success-bg px-4 py-5 text-center font-semibold text-success">Used at the door at {used}</p>
      ) : admits ? <img alt={`QR code for ticket ${reference}`} className="mb-4 size-44 self-center rounded-control" height={176} src={qrSource(ticket.id)} width={176} /> : null}
      <div className="flex items-center justify-between gap-3 border-t-2 border-dashed border-line px-4 py-3">
        <span className={`font-mono text-xl font-bold tracking-[0.08em] ${admits ? "text-ink" : ticket.validity === "active" ? "text-ink-soft" : "text-ink-muted line-through"}`} title={ticket.id}>
          {reference}
        </span>
      </div>
      {ticket.validity === "refund_review" ? (
        <p className="px-4 pb-3.5 text-sm text-ink-soft">The payment is disputed. Contact {society} before the event.</p>
      ) : null}
    </article>
  );
}
