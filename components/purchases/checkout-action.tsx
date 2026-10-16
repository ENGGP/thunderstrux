"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { ClientApiError, fetchJson, getClientErrorMessage } from "@/lib/client/api";
import { formatMoney } from "@/lib/format";

type CheckoutResponse =
  | { kind: "stripe"; url: string }
  | { kind: "fulfilled"; orderId: string }
  | { attemptId: string; status: "processing" };

type AttemptStatus =
  | { status: "ready"; url: string }
  | { status: "processing" }
  | { status: "completed"; orderId: string }
  | { status: "failed" };

type Selection = { quantity: number; unitPrice: number };

// What replaces the button after a refusal or a slow answer. A refusal is read
// from the API detail's `reason` and `value`, never from its message.
type Screen =
  | { kind: "quote_changed"; unitPrice: number }
  | { kind: "insufficient_availability"; available: number }
  | { kind: "sold_out" | "sales_closed" | "stripe_not_ready" | "still_confirming" }
  | { kind: "error"; message: string };

const pollIntervalMs = 2000;
const pollAttempts = 15;
const failedMessage = "Checkout could not start. Nothing has been charged. Please try again.";
const linkClass = "inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4";

// Random bytes work outside secure contexts too, unlike crypto.randomUUID.
function newCheckoutKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function screenFor(failure: unknown): Screen {
  const detail = failure instanceof ClientApiError ? failure.payload?.error?.details?.[0] : undefined;
  const reason = detail?.reason;
  const value = detail?.value;
  if (reason === "sold_out" || reason === "sales_closed" || reason === "stripe_not_ready") return { kind: reason };
  if (reason === "quote_changed" && value !== undefined) return { kind: reason, unitPrice: value };
  if (reason === "insufficient_availability" && value) return { kind: reason, available: value };
  return { kind: "error", message: getClientErrorMessage(failure, "Checkout could not start. Please try again.") };
}

// The one button on the checkout page, and the screen that replaces it when
// checkout refuses or is slow. Any server answer ends a purchase intent, so a
// new price or quantity goes out under a new key; a double click or a retry
// after a lost response reuses the key and gets the same result.
export function CheckoutAction({
  eventId,
  eventTitle,
  society,
  ticketTypeId,
  ticketTypeName,
  quantity,
  unitPrice,
  freeTicketsAvailable,
  label,
  backHref
}: {
  eventId: string;
  eventTitle: string;
  society: string;
  ticketTypeId: string;
  ticketTypeName: string;
  quantity: number;
  unitPrice: number;
  freeTicketsAvailable: boolean;
  label: string;
  backHref: string;
}) {
  const router = useRouter();
  const key = useRef<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ quantity, unitPrice });
  const [state, setState] = useState<"idle" | "busy" | "confirming">("idle");
  const [screen, setScreen] = useState<Screen | null>(null);

  function finished(orderId: string) {
    router.push(`/events/${eventId}/checkout/confirmed?orderId=${encodeURIComponent(orderId)}`);
  }

  async function submit(next: Selection = selection) {
    setSelection(next);
    setScreen(null);
    setState("busy");
    key.current ??= newCheckoutKey();

    try {
      const data = await fetchJson<CheckoutResponse>("/api/payments/checkout/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId, ticketTypeId, quantity: next.quantity, expectedUnitPrice: next.unitPrice, idempotencyKey: key.current })
      });
      if ("kind" in data && data.kind === "fulfilled") return finished(data.orderId);
      if ("kind" in data && data.kind === "stripe") {
        window.location.href = data.url;
        return;
      }
      if ("attemptId" in data) await waitForCheckout(data.attemptId);
    } catch (failure) {
      setState("idle");
      // A server answer settles this intent; a lost response keeps the key so a retry finds the same checkout.
      if (failure instanceof ClientApiError || (failure instanceof Error && failure.message === failedMessage)) key.current = null;
      const refused = screenFor(failure);
      // Reload so the summary shows the new price beside the screen that offers it.
      if (refused.kind === "quote_changed") router.refresh();
      setScreen(refused);
    }
  }

  // Stripe's answer was not known when checkout returned: poll the attempt until
  // its Session is ready, the order completes, or it fails.
  async function waitForCheckout(attemptId: string) {
    setState("confirming");
    for (let poll = 0; poll < pollAttempts; poll += 1) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      const attempt = await fetchJson<AttemptStatus>(`/api/payments/checkout/attempts/${attemptId}`);
      if (attempt.status === "ready") {
        window.location.href = attempt.url;
        return;
      }
      if (attempt.status === "completed") return finished(attempt.orderId);
      if (attempt.status === "failed") throw new Error(failedMessage);
    }
    setState("idle");
    setScreen({ kind: "still_confirming" });
  }

  // A smaller quantity is a new selection: the address follows it, so the summary does too.
  function continueWith(available: number) {
    router.replace(`/events/${eventId}/checkout?ticketTypeId=${ticketTypeId}&quantity=${available}`, { scroll: false });
    void submit({ ...selection, quantity: available });
  }

  const tickets = (count: number) => (count === 1 ? "ticket" : "tickets");
  const changeTickets = (
    <Link className={linkClass} href={backHref}>
      Change tickets
    </Link>
  );
  const backTo = (text: string) => (
    <Link className={linkClass} href={backHref}>
      {text}
    </Link>
  );

  switch (screen?.kind) {
    case "quote_changed": {
      const next = { ...selection, unitPrice: screen.unitPrice };
      const total = formatMoney(next.unitPrice * next.quantity);
      return (
        <StateScreen
          actions={<><Button onClick={() => submit(next)} type="button">Continue at {total}</Button>{changeTickets}</>}
          title="The price changed"
          tone="warning"
        >
          {ticketTypeName} is now {formatMoney(next.unitPrice)} per ticket. Your new total is {total}. Nothing has been charged.
        </StateScreen>
      );
    }
    case "insufficient_availability": {
      const { available } = screen;
      return (
        <StateScreen
          actions={<><Button onClick={() => continueWith(available)} type="button">Continue with {available} {tickets(available)}</Button>{changeTickets}</>}
          title={`Only ${available} ${tickets(available)} left`}
          tone="warning"
        >
          There {available === 1 ? "is" : "are"} {available} {ticketTypeName} {tickets(available)} left, and you asked for {selection.quantity}. Nothing has been charged.
        </StateScreen>
      );
    }
    case "sold_out":
      return (
        <StateScreen actions={backTo("Back to ticket options")} title="No tickets remaining" tone="danger">
          Someone else got the last {ticketTypeName} ticket first. Nothing has been charged.
        </StateScreen>
      );
    case "sales_closed":
      return (
        <StateScreen actions={backTo("Back to the event")} title="Ticket sales have closed" tone="info">
          {eventTitle} is no longer selling tickets. Nothing has been charged.
        </StateScreen>
      );
    case "stripe_not_ready":
      return (
        <StateScreen actions={backTo("Back to ticket options")} title="Paid checkout unavailable" tone="warning">
          {society} can&apos;t take payments right now.{freeTicketsAvailable ? " Free tickets are still available." : ""} Nothing has been charged.
        </StateScreen>
      );
    case "still_confirming":
      return (
        <StateScreen
          actions={<><Button onClick={() => submit()} type="button" variant="secondary">Try again</Button><Link className={linkClass} href="/tickets">Go to My tickets</Link></>}
          title="We're still confirming your checkout"
          tone="info"
        >
          Try again in a minute; you will not be charged twice. If you already paid, your tickets will appear in My tickets.
        </StateScreen>
      );
  }

  return (
    <div className="grid gap-3">
      {screen?.kind === "error" ? (
        <Notice role="alert" tone="danger">
          <p>{screen.message}</p>
          <div className="mt-1">{changeTickets}</div>
        </Notice>
      ) : null}
      {state === "confirming" ? (
        <p className="text-sm text-ink-soft" role="status">
          Confirming your checkout… This usually takes a few seconds. Your tickets are held, and you will not be charged twice.
        </p>
      ) : null}
      <Button disabled={state !== "idle"} onClick={() => submit()} size="lg" type="button">
        {state === "confirming" ? "Confirming checkout..." : state === "busy" ? (selection.unitPrice === 0 ? "Confirming..." : "Opening Stripe...") : label}
      </Button>
    </div>
  );
}

function StateScreen({ tone, title, actions, children }: { tone: "info" | "warning" | "danger"; title: string; actions: ReactNode; children: ReactNode }) {
  return (
    <Notice role="alert" title={title} tone={tone}>
      <p>{children}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-3">{actions}</div>
    </Notice>
  );
}
