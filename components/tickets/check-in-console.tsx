"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { buttonClasses } from "@/components/ui/button";
import { fetchWithCsrf } from "@/lib/client/api";
import type { OrganisationEventTicket } from "@/lib/tickets/check-in";

// Dates arrive as Date from the server page and as strings from the search API.
type ConsoleTicket = Omit<OrganisationEventTicket, "createdAt" | "checkedInAt" | "validityChangedAt"> & {
  createdAt: Date | string;
  checkedInAt: Date | string | null;
  validityChangedAt: Date | string | null;
};

const requestTimeoutMs = 10_000;

const reference = (id: string) => id.slice(-6).toUpperCase();

// The ticket as the server has it now; null when it can't be read.
async function readTicket(eventId: string, ticketId: string): Promise<ConsoleTicket | null> {
  const response = await fetch(`/api/events/${eventId}/tickets?q=${encodeURIComponent(ticketId)}`, { cache: "no-store", signal: AbortSignal.timeout(requestTimeoutMs) });
  if (!response.ok) return null;
  const body = (await response.json()) as { tickets: ConsoleTicket[] };
  return body.tickets.find((ticket) => ticket.id === ticketId) ?? null;
}

// What the door should do with this ticket, in words and colour.
function verdict(ticket: ConsoleTicket, timeZone: string) {
  const day = (value: Date | string | null) => (value ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone }).format(new Date(value)) : null);
  if (ticket.validity === "refund_review") {
    return { tone: "warning", label: "Under review", detail: "The payment is disputed. Ask an owner or finance manager before admitting." };
  }
  if (ticket.validity === "void") {
    const on = day(ticket.validityChangedAt);
    const detail = ticket.validityReason === "refunded" || ticket.validityReason === "refunded_outside"
      ? `Refunded${on ? ` on ${on}` : ""}. This ticket is no longer valid.`
      : ticket.validityReason === "cancelled"
        ? `Cancelled by the society${on ? ` on ${on}` : ""}. This ticket is no longer valid.`
        : ticket.validityReason === "dispute_lost"
          ? "The buyer's bank reversed the payment. This ticket is no longer valid."
          : "This ticket is no longer valid.";
    return { tone: "danger", label: "Don't admit", detail };
  }
  if (ticket.checkedInAt) {
    const time = new Intl.DateTimeFormat("en-AU", { timeStyle: "short", timeZone }).format(new Date(ticket.checkedInAt));
    return { tone: "info", label: "Checked in", detail: `Already checked in at ${time}${ticket.checkedInBy ? ` by ${ticket.checkedInBy}` : ""}` };
  }
  return { tone: "success", label: "Valid", detail: null };
}

const tones: Record<string, { card: string; label: string }> = {
  success: { card: "border-success-border bg-success-bg", label: "text-success" },
  info: { card: "border-info-border bg-info-bg", label: "text-info" },
  warning: { card: "border-warning-border bg-warning-bg", label: "text-warning" },
  danger: { card: "border-danger-border bg-danger-bg", label: "text-danger" },
  unknown: { card: "border-line bg-surface", label: "text-ink-soft" }
};

// One ticket at the door. After any answer from the server the card re-reads
// the ticket, so it always shows what was saved; with no answer it says the
// status is unknown and offers a reload instead of guessing.
function CheckInCard({ eventId, timeZone, initial }: { eventId: string; timeZone: string; initial: ConsoleTicket }) {
  const router = useRouter();
  const [ticket, setTicket] = useState(initial);
  const [unknown, setUnknown] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setTicket(initial), [initial]);

  async function reload() {
    setBusy(true);
    try {
      const fresh = await readTicket(eventId, ticket.id);
      if (fresh) {
        setTicket(fresh);
        setUnknown(false);
      }
    } catch {
      // Still no answer: the card keeps saying the status is unknown.
    } finally {
      setBusy(false);
    }
  }

  async function act(action: "check-in" | "check-out") {
    setBusy(true);
    try {
      await fetchWithCsrf(`/api/tickets/${ticket.id}/${action}`, { method: "POST", signal: AbortSignal.timeout(requestTimeoutMs) });
    } catch {
      setUnknown(true);
      setBusy(false);
      return;
    }
    // Saved, or refused for a reason (already checked in, refunded): either way show the ticket as it is now.
    await reload();
    router.refresh();
  }

  const name = ticket.buyerName ?? ticket.buyerEmail ?? "Unknown buyer";
  const state = unknown ? { tone: "unknown", label: "Status unknown", detail: "We didn't hear back, so we can't say whether that saved." } : verdict(ticket, timeZone);
  const tone = tones[state.tone];
  const big = "min-h-14 w-full text-lg md:w-auto md:min-h-11 md:text-[15px]";

  return (
    <li aria-label={`${name}, ${state.label}`} className={`grid gap-2 rounded-card border-2 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center md:gap-4 ${tone.card}`}>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3 md:block">
          <h3 className="font-display text-[22px] font-semibold leading-tight text-ink [overflow-wrap:anywhere] md:text-lg">{name}</h3>
          <strong className={`shrink-0 md:hidden ${tone.label}`}>{state.label}</strong>
        </div>
        <p className="text-sm text-ink">
          {ticket.ticketTypeName} · <span className="font-mono font-bold tracking-[0.06em]" title={ticket.id}>{reference(ticket.id)}</span> · {ticket.issueSequence} of {ticket.orderQuantity}
        </p>
        {ticket.buyerName && ticket.buyerEmail ? <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{ticket.guest ? "guest · " : ""}{ticket.buyerEmail}</p> : null}
      </div>
      <div className="grid gap-0.5">
        <strong className={`hidden md:block ${tone.label}`}>{state.label}</strong>
        {state.detail ? <p className={`text-sm font-semibold ${state.tone === "danger" ? "text-danger" : "text-ink"}`} role={unknown ? "status" : undefined}>{state.detail}</p> : null}
      </div>
      <div>
        {unknown ? (
          <button className={buttonClasses({ className: big })} disabled={busy} onClick={reload} type="button">Reload ticket</button>
        ) : ticket.validity !== "active" ? null : ticket.checkedInAt ? (
          <button className={buttonClasses({ variant: "secondary", className: big })} disabled={busy} onClick={() => act("check-out")} type="button">
            Undo check-in<span className="sr-only"> for {name}</span>
          </button>
        ) : (
          <button className={`inline-flex items-center justify-center rounded-control px-4 font-semibold text-white bg-success hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 ${big}`} disabled={busy} onClick={() => act("check-in")} type="button">
            Check in<span className="sr-only"> {name}</span>
          </button>
        )}
      </div>
    </li>
  );
}

// Search the event's tickets as staff type (from 2 characters); with no
// search it shows the server's page of tickets that admit.
export function CheckInConsole({ eventId, timeZone, initialTickets, footer }: { eventId: string; timeZone: string; initialTickets: ConsoleTicket[]; footer?: ReactNode }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ConsoleTicket[] | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  const searching = query.trim().length >= 2;

  useEffect(() => {
    if (!searching) {
      setResults(null);
      return;
    }
    const request = ++latest.current;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/events/${eventId}/tickets?q=${encodeURIComponent(query.trim())}`, { cache: "no-store", signal: AbortSignal.timeout(requestTimeoutMs) });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { tickets: ConsoleTicket[] };
        // An older search that answers late never replaces a newer one.
        if (request === latest.current) {
          setResults(body.tickets);
          setFailed(false);
        }
      } catch {
        if (request === latest.current) setFailed(true);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [eventId, query, searching]);

  const shown = searching ? results : initialTickets;
  return (
    <div className="grid gap-4">
      <label className="grid max-w-2xl gap-1.5 text-sm font-semibold text-ink">
        Find a ticket
        <input
          autoComplete="off"
          className="h-14 rounded-[12px] border-2 border-brand bg-surface px-4 text-xl font-normal text-ink md:h-[52px] md:text-lg"
          onChange={(event) => setQuery(event.target.value)}
          type="search"
          value={query}
        />
        <span className="text-[13px] font-normal text-ink-muted">Name, email, order or ticket reference. Results update as you type.</span>
      </label>
      {failed ? <p className="text-sm text-danger" role="alert">Search didn&apos;t answer. Check the connection and type again.</p> : null}
      {shown === null ? null : shown.length === 0 ? (
        <div className="grid gap-1.5 rounded-card border border-dashed border-line-strong bg-surface p-5" role="status">
          <strong className="text-ink">{searching ? `No ticket matches "${query.trim()}"` : "No issued tickets yet."}</strong>
          {searching ? <span className="text-sm text-ink-soft">Check the spelling, or ask for the ticket reference from their email.</span> : null}
        </div>
      ) : (
        <ul aria-label={searching ? "Matching tickets" : "Tickets"} className="grid gap-3">
          {shown.map((ticket) => <CheckInCard eventId={eventId} initial={ticket} key={ticket.id} timeZone={timeZone} />)}
        </ul>
      )}
      {searching ? null : footer}
    </div>
  );
}
