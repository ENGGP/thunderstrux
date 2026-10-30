"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { buttonClasses } from "@/components/ui/button";
import { formatClock, formatDayMonth, ticketReference } from "@/lib/format";
import { fetchWithCsrf } from "@/lib/client/api";
import type { OrganisationEventTicket } from "@/lib/tickets/check-in";

// Dates arrive as Date from the server page and as strings from the search API.
type ConsoleTicket = Omit<OrganisationEventTicket, "createdAt" | "checkedInAt" | "validityChangedAt"> & {
  createdAt: Date | string;
  checkedInAt: Date | string | null;
  validityChangedAt: Date | string | null;
};

const requestTimeoutMs = 10_000;


// The ticket as the server has it now; null when it can't be read.
async function readTicket(eventId: string, ticketId: string): Promise<ConsoleTicket | null> {
  const response = await fetch(`/api/events/${eventId}/tickets?q=${encodeURIComponent(ticketId)}`, { cache: "no-store", signal: AbortSignal.timeout(requestTimeoutMs) });
  if (!response.ok) return null;
  const body = (await response.json()) as { tickets: ConsoleTicket[] };
  return body.tickets.find((ticket) => ticket.id === ticketId) ?? null;
}

// What this card's own last check-in did: admitted just now, or refused because
// someone had already used the ticket. Null when the card hasn't acted.
type Outcome = "checked-in" | "already-used" | null;

// Answers that saved nothing and say nothing about the ticket: keep the card as it was.
const refusals: Record<number, string> = {
  401: "Not saved: your sign-in has ended. Sign in again, then try.",
  403: "Not saved: this account can't check people in any more. Ask an owner.",
  429: "Not saved: too many check-ins at once. Wait a few seconds, then try again."
};

async function conflictReason(response: Response) {
  try {
    const body = (await response.json()) as { error?: { details?: Array<{ reason?: string }> } };
    return body.error?.details?.[0]?.reason ?? null;
  } catch {
    return null;
  }
}

// What the door should do with this ticket, in words and colour.
function verdict(ticket: ConsoleTicket, timeZone: string, outcome: Outcome) {
  const day = (value: Date | string | null) => (value ? formatDayMonth(value, timeZone) : null);
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
    const time = formatClock(ticket.checkedInAt, timeZone);
    const by = ticket.checkedInBy ? ` by ${ticket.checkedInBy}` : "";
    // Admitted by this tap, or a second person on one ticket: the door must tell them apart.
    if (outcome === "checked-in") return { tone: "success", label: "Checked in", detail: "Checked in just now." };
    if (outcome === "already-used") return { tone: "warning", label: "Already used", detail: `Checked in at ${time}${by}. Don't admit twice.` };
    return { tone: "info", label: "Checked in", detail: `Checked in at ${time}${by}.` };
  }
  // Every state has a detail line, so admitting someone never pushes the button down.
  return { tone: "success", label: "Valid", detail: "Not checked in yet." };
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
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Briefly after admitting someone the action can't be pressed, so a second tap never lands on Undo.
  const [locked, setLocked] = useState(false);
  useEffect(() => setTicket(initial), [initial]);
  useEffect(() => {
    if (!locked) return;
    const timer = setTimeout(() => setLocked(false), 2000);
    return () => clearTimeout(timer);
  }, [locked]);

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
    let response: Response;
    try {
      response = await fetchWithCsrf(`/api/tickets/${ticket.id}/${action}?eventId=${encodeURIComponent(eventId)}`, { method: "POST", signal: AbortSignal.timeout(requestTimeoutMs) });
    } catch {
      setRefusal(null);
      setUnknown(true);
      setBusy(false);
      return;
    }
    const refused = refusals[response.status];
    if (refused) {
      setRefusal(refused);
      setBusy(false);
      return;
    }
    setRefusal(null);
    if (action === "check-in" && response.ok) {
      setOutcome("checked-in");
      setLocked(true);
    } else if (action === "check-in" && response.status === 409 && (await conflictReason(response)) === "already_checked_in") {
      setOutcome("already-used");
    } else {
      setOutcome(null);
    }
    // Saved, or refused for a reason (already checked in, refunded): either way show the ticket as it is now.
    await reload();
    router.refresh();
  }

  const name = ticket.buyerName ?? ticket.buyerEmail ?? "Unknown buyer";
  const state = unknown ? { tone: "unknown", label: "Status unknown", detail: "We didn't hear back, so we can't say whether that saved." } : verdict(ticket, timeZone, outcome);
  const tone = tones[state.tone];
  const big = "min-h-14 w-full text-lg md:w-auto md:min-h-11 md:text-ui";
  const detail = refusal ?? state.detail;

  return (
    <li aria-label={`${name}, ${state.label}`} className={`grid gap-2 rounded-card border-2 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center md:gap-4 ${tone.card}`}>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3 md:block">
          <h3 className="font-display text-[22px] font-semibold leading-tight text-ink [overflow-wrap:anywhere] md:text-lg">{name}</h3>
          <strong className={`shrink-0 md:hidden ${tone.label}`}>{state.label}</strong>
        </div>
        <p className="text-sm text-ink">
          {ticket.ticketTypeName} · <span className="font-mono font-bold tracking-[0.06em]" title={ticket.id}>{ticketReference(ticket.id)}</span> · {ticket.issueSequence} of {ticket.orderQuantity}
        </p>
        {ticket.buyerName && ticket.buyerEmail ? <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{ticket.guest ? "guest · " : ""}{ticket.buyerEmail}</p> : null}
      </div>
      <div className="grid gap-0.5">
        <strong className={`hidden md:block ${tone.label}`}>{state.label}</strong>
        {detail ? <p className={`text-sm font-semibold ${refusal || state.tone === "danger" ? "text-danger" : "text-ink"}`} role={refusal ? "alert" : unknown ? "status" : undefined}>{detail}</p> : null}
      </div>
      <div className={ticket.validity === "active" || unknown ? "flex min-h-14 items-center justify-end md:min-h-11" : undefined}>
        {unknown ? (
          <button className={buttonClasses({ className: big })} disabled={busy} onClick={reload} type="button">Reload ticket</button>
        ) : ticket.validity !== "active" ? null : ticket.checkedInAt && locked ? (
          <span aria-hidden="true" className={`inline-flex items-center justify-center rounded-control border border-success-border bg-surface px-4 font-semibold text-success ${big}`}>
            Checked in
          </span>
        ) : ticket.checkedInAt ? (
          // Small and to the side, away from where Check in was tapped.
          <button className={buttonClasses({ variant: "tertiary", size: "sm" })} disabled={busy} onClick={() => act("check-out")} type="button">
            Undo check-in<span className="sr-only"> for {name}</span>
          </button>
        ) : (
          <button className={`inline-flex items-center justify-center rounded-control px-4 font-semibold text-white bg-success transition-[opacity,scale] duration-150 ease-out hover:opacity-90 active:not-disabled:scale-97 disabled:cursor-not-allowed disabled:opacity-60 ${big}`} disabled={busy} onClick={() => act("check-in")} type="button">
            Check in<span className="sr-only"> {name}</span>
          </button>
        )}
      </div>
    </li>
  );
}

const searchLimit = 25;

// Search the event's tickets as staff type (from 2 characters); with no
// search it shows the server's page of tickets that admit. A search shows its
// first 25 matches and says so when there are more, and the list on screen
// stays until the answer arrives.
export function CheckInConsole({ eventId, timeZone, initialTickets, footer }: { eventId: string; timeZone: string; initialTickets: ConsoleTicket[]; footer?: ReactNode }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ tickets: ConsoleTicket[]; more: boolean } | null>(null);
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
        const response = await fetch(`/api/events/${eventId}/tickets?q=${encodeURIComponent(query.trim())}&limit=${searchLimit}`, { cache: "no-store", signal: AbortSignal.timeout(requestTimeoutMs) });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { tickets: ConsoleTicket[]; pageInfo?: { hasNextPage: boolean } };
        // An older search that answers late never replaces a newer one.
        if (request === latest.current) {
          setResults({ tickets: body.tickets, more: Boolean(body.pageInfo?.hasNextPage) });
          setFailed(false);
        }
      } catch {
        if (request === latest.current) setFailed(true);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [eventId, query, searching]);

  // Until the first answer, the list on screen stays rather than emptying.
  const shown = searching && results ? results.tickets : initialTickets;
  const pending = searching && !results;
  return (
    <div className="grid gap-4">
      <label className="grid max-w-2xl gap-1.5 text-sm font-semibold text-ink">
        Find a ticket
        <input
          autoComplete="off"
          // The door is search-first: the field takes focus, which also brings it into view on a phone.
          autoFocus
          className="h-14 rounded-[12px] border-2 border-brand bg-surface px-4 text-xl font-normal text-ink md:h-[52px] md:text-lg"
          onChange={(event) => setQuery(event.target.value)}
          type="search"
          value={query}
        />
        <span className="text-caption font-normal text-ink-muted">Name, email, order or ticket reference. Results update as you type.</span>
      </label>
      {failed ? <p className="text-sm text-danger" role="alert">Search didn&apos;t answer. Check the connection and type again.</p> : null}
      {shown.length === 0 ? (
        <div className="grid gap-1.5 rounded-card border border-dashed border-line-strong bg-surface p-5" role="status">
          <strong className="text-ink">{searching && !pending ? `No ticket matches "${query.trim()}"` : "No issued tickets yet."}</strong>
          {searching && !pending ? <span className="text-sm text-ink-soft">Check the spelling, or ask for the ticket reference from their email.</span> : null}
        </div>
      ) : (
        <ul aria-busy={pending || undefined} aria-label={searching && !pending ? "Matching tickets" : "Tickets"} className="grid gap-3">
          {shown.map((ticket) => <CheckInCard eventId={eventId} initial={ticket} key={ticket.id} timeZone={timeZone} />)}
        </ul>
      )}
      {searching && results?.more ? <p className="text-sm text-ink-soft">Showing the first {searchLimit} matches. Keep typing to narrow it down.</p> : null}
      {searching ? null : footer}
    </div>
  );
}
