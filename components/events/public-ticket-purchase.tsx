"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { ClientApiError, fetchJson, getClientErrorMessage } from "@/lib/client/api";
import { formatMoney } from "@/lib/format";
import { maxTicketsPerOrder } from "@/lib/validators/payments";

type TicketType = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  availableQuantity: number;
};

type CheckoutResponse = { url: string } | { attemptId: string; status: "processing" };

type AttemptStatus =
  | { status: "ready"; url: string }
  | { status: "processing" }
  | { status: "completed"; orderId: string }
  | { status: "failed" };

const pollIntervalMs = 2000;
const pollAttempts = 15;

// Random bytes work outside secure contexts too, unlike crypto.randomUUID.
function newCheckoutKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const checkoutFailedMessage = "Checkout could not start. Please try again.";

function isSoldOut(ticketType: TicketType) {
  return ticketType.quantity <= 0 || ticketType.availableQuantity <= 0;
}

// One ticket type, one quantity, one buy button. The checkout API re-checks
// sign-in, verification, availability and Stripe readiness.
export function PublicTicketPurchase({
  eventId,
  ticketTypes
}: {
  eventId: string;
  ticketTypes: TicketType[];
}) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [selectedId, setSelectedId] = useState(
    ticketTypes.find((ticketType) => !isSoldOut(ticketType))?.id ?? ticketTypes[0]?.id ?? ""
  );
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per purchase intent: a double click or a retry after a lost response
  // reuses it, so the server answers with the same checkout instead of a second one.
  const checkoutKey = useRef<string | null>(null);
  const startNewIntent = () => {
    checkoutKey.current = null;
  };
  const selected = ticketTypes.find((ticketType) => ticketType.id === selectedId);
  const allSoldOut = ticketTypes.every(isSoldOut);
  // Shown before checkout instead of letting the request fail late.
  const needsVerification = status === "authenticated" && !session?.user?.emailVerifiedAt;
  const maxQuantity = Math.min(selected?.availableQuantity ?? 0, maxTicketsPerOrder);

  if (ticketTypes.length === 0) {
    return (
      <section className="rounded-card border border-line bg-surface p-5">
        <h2 className="text-xl font-semibold text-ink">Tickets</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Tickets are not available for this event yet.
        </p>
      </section>
    );
  }

  async function startCheckout() {
    if (status === "unauthenticated") {
      setError("Please sign in to continue checkout.");
      router.push(`/login?callbackUrl=${encodeURIComponent(`/events/${eventId}`)}`);
      return;
    }

    if (status !== "authenticated") {
      setError("Checking sign-in status. Please try again in a moment.");
      return;
    }

    if (!selected || quantity < 1 || quantity > maxQuantity) {
      setError("Choose a valid ticket quantity.");
      return;
    }

    setError(null);
    setBusy(true);
    checkoutKey.current ??= newCheckoutKey();

    try {
      const data = await fetchJson<CheckoutResponse>(
        "/api/payments/checkout/event",
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            eventId,
            ticketTypeId: selected.id,
            quantity,
            expectedUnitPrice: selected.price,
            idempotencyKey: checkoutKey.current
          })
        }
      );

      if ("url" in data) {
        window.location.href = data.url;
        return;
      }
      await waitForCheckout(data.attemptId);
    } catch (checkoutError) {
      setBusy(false);
      setConfirming(false);
      // A server answer settles this intent; a lost response keeps the key so a retry finds the same checkout.
      if (checkoutError instanceof ClientApiError || (checkoutError instanceof Error && checkoutError.message === checkoutFailedMessage)) {
        startNewIntent();
      }
      // The price changed since this page loaded: reload it so the buyer sees the new price first.
      if (checkoutError instanceof ClientApiError && checkoutError.status === 409) router.refresh();
      setError(
        getClientErrorMessage(
          checkoutError,
          "Unable to start checkout. Please try again.",
          {
            "Stripe not connected":
              "The organiser must complete Stripe onboarding before ticket sales can start."
          }
        )
      );
    }
  }

  // Stripe's answer was not known when checkout returned: poll the attempt until
  // its Session is ready, the order completes, or it fails.
  async function waitForCheckout(attemptId: string) {
    setConfirming(true);
    for (let poll = 0; poll < pollAttempts; poll += 1) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      const attempt = await fetchJson<AttemptStatus>(`/api/payments/checkout/attempts/${attemptId}`);
      if (attempt.status === "ready") {
        window.location.href = attempt.url;
        return;
      }
      if (attempt.status === "completed") {
        router.push("/tickets");
        return;
      }
      if (attempt.status === "failed") throw new Error(checkoutFailedMessage);
    }
    setBusy(false);
    setConfirming(false);
    setError("We are still confirming your checkout. Try again in a minute; you will not be charged twice.");
  }

  const validQuantity = Boolean(selected) && quantity >= 1 && quantity <= maxQuantity;

  return (
    <section aria-labelledby="tickets-heading" className="grid gap-4 rounded-card border border-line bg-surface p-5">
      <h2 className="text-xl font-semibold text-ink" id="tickets-heading">Tickets</h2>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-semibold text-ink">Choose a ticket</legend>
        {ticketTypes.map((ticketType) => {
          const soldOut = isSoldOut(ticketType);

          return (
            <label
              className={`flex items-center gap-3 rounded-control border px-3 py-3 ${
                soldOut
                  ? "cursor-not-allowed border-line text-ink-muted"
                  : "cursor-pointer border-line-strong has-[:checked]:border-brand has-[:checked]:bg-brand-tint"
              }`}
              key={ticketType.id}
            >
              <input
                checked={selectedId === ticketType.id}
                className="size-4 accent-brand"
                disabled={soldOut || busy}
                name="ticket-type"
                onChange={() => {
                  setSelectedId(ticketType.id);
                  setQuantity(1);
                  startNewIntent();
                }}
                type="radio"
                value={ticketType.id}
              />
              <span className="grid min-w-0 flex-1">
                <span className="font-semibold text-ink [overflow-wrap:anywhere]">{ticketType.name}</span>
                <span className="text-sm text-ink-soft">
                  {soldOut ? "Sold out" : `${ticketType.availableQuantity} remaining`}
                </span>
              </span>
              <span className="font-semibold tabular-nums text-ink">{formatMoney(ticketType.price)}</span>
            </label>
          );
        })}
      </fieldset>

      {needsVerification ? (
        <Notice title="Verify your email to buy tickets">
          <p>Purchases need a verified email so your tickets reach you.</p>
          <Link
            className="mt-1 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
            href={`/verify-email?callbackUrl=${encodeURIComponent(`/events/${eventId}`)}`}
          >
            Verify email
          </Link>
        </Notice>
      ) : (
        <>
          <div className="w-40">
            <TextInput
              disabled={allSoldOut || busy}
              hint={`Up to ${maxTicketsPerOrder} per order`}
              inputMode="numeric"
              label="Quantity"
              max={Math.max(maxQuantity, 1)}
              min={1}
              onChange={(event) => {
                setQuantity(Number(event.target.value));
                startNewIntent();
              }}
              type="number"
              value={quantity}
            />
          </div>

          {error ? (
            <Notice role="alert" tone="danger">
              {error}
            </Notice>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            {selected && validQuantity && !allSoldOut ? (
              <p className="text-sm text-ink-soft">
                {quantity} × {selected.name}{" "}
                <span className="font-semibold tabular-nums text-ink">{formatMoney(selected.price * quantity)}</span>
              </p>
            ) : <span />}
            <Button
              disabled={allSoldOut || busy || status === "loading" || !validQuantity}
              onClick={startCheckout}
              size="lg"
              type="button"
            >
              {confirming ? "Confirming checkout..." : busy ? "Redirecting..." : allSoldOut ? "Sold out" : "Buy tickets"}
            </Button>
          </div>
          <p className="text-[13px] text-ink-muted">
            You pay securely with Stripe on the next page. Your tickets are emailed and appear in My tickets.
          </p>
        </>
      )}
    </section>
  );
}
