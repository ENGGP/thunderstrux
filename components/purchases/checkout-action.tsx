"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { ClientApiError, fetchJson, getClientErrorMessage } from "@/lib/client/api";

type CheckoutResponse =
  | { kind: "stripe"; url: string }
  | { kind: "fulfilled"; orderId: string }
  | { attemptId: string; status: "processing" };

type AttemptStatus =
  | { status: "ready"; url: string }
  | { status: "processing" }
  | { status: "completed"; orderId: string }
  | { status: "failed" };

const pollIntervalMs = 2000;
const pollAttempts = 15;
const failedMessage = "Checkout could not start. Nothing has been charged. Please try again.";

// Random bytes work outside secure contexts too, unlike crypto.randomUUID.
function newCheckoutKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// The one button on the checkout page. The page remounts it when the price it
// shows changes, so each reviewed quote is its own purchase intent; a double
// click or a retry after a lost response reuses the key and gets the same result.
export function CheckoutAction({
  eventId,
  ticketTypeId,
  quantity,
  unitPrice,
  label,
  backHref
}: {
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  unitPrice: number;
  label: string;
  backHref: string;
}) {
  const router = useRouter();
  const key = useRef<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "confirming">("idle");
  const [error, setError] = useState<string | null>(null);

  function finished(orderId: string) {
    router.push(`/events/${eventId}/checkout/confirmed?orderId=${encodeURIComponent(orderId)}`);
  }

  async function submit() {
    setError(null);
    setState("busy");
    key.current ??= newCheckoutKey();

    try {
      const data = await fetchJson<CheckoutResponse>("/api/payments/checkout/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId, ticketTypeId, quantity, expectedUnitPrice: unitPrice, idempotencyKey: key.current })
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
      // The price changed: reload so the summary shows the new total before the buyer continues.
      if (failure instanceof ClientApiError && failure.status === 409) router.refresh();
      setError(getClientErrorMessage(failure, "Checkout could not start. Please try again."));
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
    setError("We are still confirming your checkout. Try again in a minute; you will not be charged twice. If you already paid, your tickets will appear in My tickets.");
  }

  return (
    <div className="grid gap-3">
      {error ? (
        <Notice role="alert" tone="danger">
          <p>{error}</p>
          <Link className="mt-1 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4" href={backHref}>
            Change tickets
          </Link>
        </Notice>
      ) : null}
      {state === "confirming" ? (
        <p className="text-sm text-ink-soft" role="status">
          Confirming your checkout… This usually takes a few seconds. Your tickets are held, and you will not be charged twice.
        </p>
      ) : null}
      <Button disabled={state !== "idle"} onClick={submit} size="lg" type="button">
        {state === "confirming" ? "Confirming checkout..." : state === "busy" ? (unitPrice === 0 ? "Confirming..." : "Opening Stripe...") : label}
      </Button>
    </div>
  );
}
