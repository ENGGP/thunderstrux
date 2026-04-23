"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { fetchJson } from "@/lib/client/api";

type TicketType = {
  id: string;
  name: string;
  price: number;
  quantity: number;
};

type CheckoutResponse = {
  url: string;
};

function formatCurrency(amountInCents: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "AUD"
  }).format(amountInCents / 100);
}

export function PublicTicketPurchase({
  eventId,
  ticketTypes
}: {
  eventId: string;
  ticketTypes: TicketType[];
}) {
  const router = useRouter();
  const { status } = useSession();
  const [quantities, setQuantities] = useState<Record<string, number>>(
    Object.fromEntries(ticketTypes.map((ticketType) => [ticketType.id, 1]))
  );
  const [activeTicketTypeId, setActiveTicketTypeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (ticketTypes.length === 0) {
    return (
      <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-neutral-950">Tickets</h2>
        <p className="mt-2 text-sm text-neutral-600">
          Tickets are not available for this event yet.
        </p>
      </section>
    );
  }

  async function startCheckout(ticketType: TicketType) {
    if (status === "unauthenticated") {
      setError("Please sign in to continue checkout.");
      router.push(`/login?callbackUrl=${encodeURIComponent(`/events/${eventId}`)}`);
      return;
    }

    if (status !== "authenticated") {
      setError("Checking sign-in status. Please try again in a moment.");
      return;
    }

    const quantity = quantities[ticketType.id] ?? 1;

    if (quantity < 1 || quantity > ticketType.quantity) {
      setError("Choose a valid ticket quantity.");
      return;
    }

    setError(null);
    setActiveTicketTypeId(ticketType.id);

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
            ticketTypeId: ticketType.id,
            quantity
          })
        }
      );

      window.location.href = data.url;
    } catch (checkoutError) {
      setActiveTicketTypeId(null);
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Unable to start checkout. Please try again."
      );
    }
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-neutral-950">Tickets</h2>
        <p className="text-sm text-neutral-600">Select a ticket type and quantity.</p>
      </div>

      {error ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="mt-5 grid gap-3">
        {ticketTypes.map((ticketType) => {
          const quantity = quantities[ticketType.id] ?? 1;
          const isSoldOut = ticketType.quantity <= 0;
          const isLoading = activeTicketTypeId === ticketType.id;

          return (
            <div
              className="grid gap-4 rounded-md border border-neutral-200 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
              key={ticketType.id}
            >
              <div>
                <h3 className="font-medium text-neutral-950">{ticketType.name}</h3>
                <p className="mt-1 text-sm text-neutral-600">
                  {formatCurrency(ticketType.price)} - {ticketType.quantity} remaining
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`quantity-${ticketType.id}`}>
                  Quantity
                </label>
                <input
                  className="h-10 w-24 rounded-md border border-neutral-300 px-3 text-sm text-neutral-950 outline-none focus:border-neutral-500 disabled:bg-neutral-100"
                  disabled={isSoldOut || isLoading}
                  id={`quantity-${ticketType.id}`}
                  max={Math.max(ticketType.quantity, 1)}
                  min={1}
                  onChange={(event) => {
                    setQuantities((current) => ({
                      ...current,
                      [ticketType.id]: Number(event.target.value)
                    }));
                  }}
                  type="number"
                  value={quantity}
                />
                <button
                  className="h-10 rounded-md bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={
                    isSoldOut ||
                    isLoading ||
                    activeTicketTypeId !== null ||
                    status === "loading" ||
                    quantity < 1 ||
                    quantity > ticketType.quantity
                  }
                  onClick={() => startCheckout(ticketType)}
                  type="button"
                >
                  {isLoading ? "Redirecting..." : isSoldOut ? "Sold out" : "Buy Ticket"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
