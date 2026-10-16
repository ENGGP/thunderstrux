"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { formatPrice } from "@/lib/format";
import { maxTicketsPerOrder } from "@/lib/validators/payments";

type TicketType = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  availableQuantity: number;
};

function isSoldOut(ticketType: TicketType) {
  return ticketType.quantity <= 0 || ticketType.availableQuantity <= 0;
}

// One ticket type and one quantity, then the checkout page, where the buyer
// reviews the order and confirms a free registration or pays with Stripe. The
// numbers here are advisory; checkout re-checks them under locks.
export function PublicTicketPurchase({
  eventId,
  ticketTypes
}: {
  eventId: string;
  ticketTypes: TicketType[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(
    ticketTypes.find((ticketType) => !isSoldOut(ticketType))?.id ?? ticketTypes[0]?.id ?? ""
  );
  const [quantity, setQuantity] = useState(1);
  const [leaving, setLeaving] = useState(false);
  const selected = ticketTypes.find((ticketType) => ticketType.id === selectedId);
  const allSoldOut = ticketTypes.every(isSoldOut);
  const maxQuantity = Math.min(selected?.availableQuantity ?? 0, maxTicketsPerOrder);
  const free = selected?.price === 0;

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
                disabled={soldOut || leaving}
                name="ticket-type"
                onChange={() => {
                  setSelectedId(ticketType.id);
                  setQuantity(1);
                }}
                type="radio"
                value={ticketType.id}
              />
              <span className="grid min-w-0 flex-1">
                <span className="font-semibold text-ink [overflow-wrap:anywhere]">{ticketType.name}</span>
                <span className="text-sm text-ink-soft">
                  {soldOut ? "Sold out" : `${ticketType.availableQuantity} left`}
                </span>
              </span>
              <span className="font-semibold tabular-nums text-ink">{formatPrice(ticketType.price)}</span>
            </label>
          );
        })}
      </fieldset>

      <div className="w-40">
        <TextInput
          disabled={allSoldOut || leaving}
          hint={`Up to ${maxTicketsPerOrder} per order`}
          inputMode="numeric"
          label="Quantity"
          max={Math.max(maxQuantity, 1)}
          min={1}
          onChange={(event) => setQuantity(Number(event.target.value))}
          type="number"
          value={quantity}
        />
      </div>

      <div className="grid gap-3 border-t border-line pt-4">
        {selected && validQuantity && !allSoldOut ? (
          <p className="flex justify-between gap-3 text-sm text-ink-soft">
            <span>{quantity} × {selected.name}</span>
            <span className="font-semibold tabular-nums text-ink">{formatPrice(selected.price * quantity)}</span>
          </p>
        ) : null}
        <Button
          disabled={allSoldOut || leaving || !validQuantity}
          onClick={() => {
            if (!selected) return;
            setLeaving(true);
            router.push(`/events/${eventId}/checkout?ticketTypeId=${encodeURIComponent(selected.id)}&quantity=${quantity}`);
          }}
          size="lg"
          type="button"
        >
          {allSoldOut ? "Sold out" : free ? "Get free tickets" : "Buy tickets"}
        </Button>
      </div>
      <p className="text-[13px] text-ink-muted">
        {free
          ? "You confirm on the next page. Your tickets are emailed and appear in My tickets."
          : "You review your order on the next page, then pay securely with Stripe."}
      </p>
    </section>
  );
}
