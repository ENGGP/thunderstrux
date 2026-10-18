"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatPrice, membershipLabel } from "@/lib/format";
import { maxTicketsPerOrder } from "@/lib/validators/payments";

type TicketType = {
  id: string;
  name: string;
  price: number;
  // What members pay; `standardPrice` is set when `price` already is it (T24b).
  memberPrice?: number | null;
  standardPrice?: number | null;
  quantity: number;
  availableQuantity: number;
  unavailable?: "sold_out" | "payments_unavailable" | null;
};

// Who is looking decides the action: a member buys, everyone else is told what to do first.
export type BuyBoxViewer = "member" | "unverified" | "anonymous" | "society";

function isSoldOut(ticketType: TicketType) {
  return ticketType.quantity <= 0 || ticketType.availableQuantity <= 0 || ticketType.unavailable === "sold_out";
}

function isUnavailable(ticketType: TicketType) {
  return isSoldOut(ticketType) || ticketType.unavailable === "payments_unavailable";
}

function Box({ badge, children }: { badge?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby="tickets-heading" className="grid gap-4 rounded-card border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold text-ink" id="tickets-heading">Tickets</h2>
        {badge ?? <span className="text-[13px] text-ink-soft">Prices in AUD</span>}
      </div>
      {children}
    </section>
  );
}

// One ticket type and one quantity, then the checkout page, where the buyer
// reviews the order and confirms a free registration or pays with Stripe. The
// numbers and reasons here are advisory; checkout re-checks them under locks.
export function PublicTicketPurchase({
  eventId,
  ticketTypes,
  society = "This society",
  viewer = "member",
  salesOpen = true,
  salesCloseLabel,
  memberPlan = null,
  societySlug,
  preview = false
}: {
  eventId: string;
  memberPlan?: string | null;
  societySlug?: string;
  ticketTypes: TicketType[];
  society?: string;
  viewer?: BuyBoxViewer;
  salesOpen?: boolean;
  salesCloseLabel?: string;
  // The organiser's draft preview: the same box with buying turned off.
  preview?: boolean;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(
    ticketTypes.find((ticketType) => !isUnavailable(ticketType))?.id ?? ""
  );
  const [quantity, setQuantity] = useState(1);
  const [leaving, setLeaving] = useState(false);
  const selected = ticketTypes.find((ticketType) => ticketType.id === selectedId && !isUnavailable(ticketType));
  const allSoldOut = ticketTypes.length > 0 && ticketTypes.every(isSoldOut);
  const paymentsUnavailable = ticketTypes.some((ticketType) => ticketType.unavailable === "payments_unavailable");
  const maxQuantity = Math.min(selected?.availableQuantity ?? 0, maxTicketsPerOrder);
  const free = selected?.price === 0;
  const checkoutHref = selected ? `/events/${eventId}/checkout?ticketTypeId=${encodeURIComponent(selected.id)}&quantity=${quantity}` : "";

  if (ticketTypes.length === 0) {
    return (
      <Box>
        <p className="text-sm text-ink-soft">Tickets aren&apos;t available for this event yet. Check back closer to the date.</p>
      </Box>
    );
  }

  if (preview) {
    return (
      <Box>
        <ul className="grid gap-2">
          {ticketTypes.map((ticketType) => (
            <li className="flex items-center gap-3 rounded-control border border-line-strong px-3 py-3" key={ticketType.id}>
              <span className="grid min-w-0 flex-1">
                <span className="font-semibold text-ink [overflow-wrap:anywhere]">{ticketType.name}</span>
                <span className="text-sm text-ink-soft">{ticketType.quantity} tickets</span>
              </span>
              <span className="font-semibold tabular-nums text-ink">{formatPrice(ticketType.price)}</span>
            </li>
          ))}
        </ul>
        <Button aria-describedby="preview-why" disabled size="lg" type="button">
          Get tickets
        </Button>
        <p className="text-sm text-ink-soft" id="preview-why">
          Buying is off in preview. After you publish, buyers see each ticket&apos;s live availability here.
        </p>
      </Box>
    );
  }

  if (!salesOpen) {
    return (
      <Box badge={<StatusBadge status="sales-closed" />}>
        <p className="text-[15px] text-ink">{salesCloseLabel ? `Ticket sales closed on ${salesCloseLabel}.` : "Ticket sales have closed."}</p>
        <p className="text-sm text-ink-soft">
          Already have a ticket? It&apos;s in{" "}
          <Link className="font-semibold text-brand underline underline-offset-4" href="/tickets">
            My tickets
          </Link>
          .
        </p>
      </Box>
    );
  }

  const validQuantity = Boolean(selected) && quantity >= 1 && quantity <= maxQuantity;
  const action =
    viewer === "society" ? (
      <Notice title="Society accounts can't buy tickets">
        <p>Sign in with a member account to buy tickets.</p>
      </Notice>
    ) : viewer === "unverified" ? (
      <Notice title="Verify your email to get tickets">
        <p>Tickets are emailed to you, so we need to know the address works.</p>
        <Link
          className="mt-1 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
          href={`/verify-email?callbackUrl=${encodeURIComponent(`/events/${eventId}`)}`}
        >
          Verify email
        </Link>
      </Notice>
    ) : viewer === "anonymous" ? (
      <>
        {/* A guest confirms their email in checkout; signing in comes straight back to the same checkout. */}
        <Button
          disabled={leaving || !validQuantity}
          onClick={() => {
            if (!checkoutHref) return;
            setLeaving(true);
            router.push(`${checkoutHref}&guest=1`);
          }}
          size="lg"
          type="button"
        >
          Continue as guest
        </Button>
        <Button
          disabled={leaving || !validQuantity}
          onClick={() => {
            if (!checkoutHref) return;
            setLeaving(true);
            router.push(checkoutHref);
          }}
          size="lg"
          type="button"
          variant="secondary"
        >
          {free ? "Sign in to get free tickets" : "Sign in to buy"}
        </Button>
        <p className="text-[13px] text-ink-muted">
          As a guest you confirm your email and your tickets go there. Signed-in members also see them in My tickets. New here?{" "}
          <Link
            className="font-semibold text-brand underline underline-offset-4"
            href={`/signup?callbackUrl=${encodeURIComponent(checkoutHref || `/events/${eventId}`)}`}
          >
            Create an account
          </Link>
          .
        </p>
      </>
    ) : (
      <>
        <Button
          disabled={leaving || !validQuantity}
          onClick={() => {
            if (!checkoutHref) return;
            setLeaving(true);
            router.push(checkoutHref);
          }}
          size="lg"
          type="button"
        >
          {free ? "Get free tickets" : "Buy tickets"}
        </Button>
        <p className="text-[13px] text-ink-muted">
          {free
            ? "You confirm on the next page. Your tickets are emailed and appear in My tickets."
            : "You review your order on the next page, then pay securely with Stripe."}
        </p>
      </>
    );

  return (
    <Box badge={allSoldOut ? <StatusBadge status="sold-out" /> : undefined}>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-semibold text-ink">Choose a ticket</legend>
        {ticketTypes.map((ticketType) => {
          const off = isUnavailable(ticketType);

          return (
            <label
              className={`flex items-center gap-3 rounded-control border px-3 py-3 ${
                off
                  ? "cursor-not-allowed border-line text-ink-muted"
                  : "cursor-pointer border-line-strong text-ink has-[:checked]:border-brand has-[:checked]:bg-brand-tint"
              }`}
              key={ticketType.id}
            >
              <input
                checked={selectedId === ticketType.id}
                className="size-4 accent-brand"
                disabled={off || leaving}
                name="ticket-type"
                onChange={() => {
                  setSelectedId(ticketType.id);
                  setQuantity(1);
                }}
                type="radio"
                value={ticketType.id}
              />
              <span className="grid min-w-0 flex-1">
                <span className="font-semibold [overflow-wrap:anywhere]">{ticketType.name}</span>
                <span className={`text-sm ${off ? "" : "text-ink-soft"}`}>
                  {isSoldOut(ticketType)
                    ? "Sold out"
                    : ticketType.unavailable === "payments_unavailable"
                      ? "Paid tickets unavailable right now"
                      : `${ticketType.availableQuantity} left`}
                  {ticketType.standardPrice != null
                    ? " · Member price"
                    : ticketType.memberPrice != null
                      ? ` · Members pay ${formatPrice(ticketType.memberPrice)}`
                      : memberPlan
                        ? " · No member price"
                        : ""}
                </span>
              </span>
              <span className="grid justify-items-end">
                <span className="font-semibold tabular-nums">{formatPrice(ticketType.price)}</span>
                {ticketType.standardPrice != null ? <s className="text-sm tabular-nums text-ink-muted">{formatPrice(ticketType.standardPrice)}</s> : null}
              </span>
            </label>
          );
        })}
      </fieldset>

      {memberPlan && ticketTypes.some((ticketType) => ticketType.standardPrice != null) ? (
        <p className="text-sm text-ink-soft">Member price through your {membershipLabel(memberPlan)}.</p>
      ) : !memberPlan && societySlug && ticketTypes.some((ticketType) => ticketType.memberPrice != null) ? (
        <p className="text-sm text-ink-soft">
          {society} members pay less. Joining for free doesn&apos;t include member prices.{" "}
          <Link className="font-semibold text-brand underline underline-offset-4" href={`/societies/${societySlug}/memberships`}>
            See memberships
          </Link>
        </p>
      ) : null}
      {paymentsUnavailable && selected ? (
        <p className="text-sm text-ink-soft">{society} can&apos;t take card payments at the moment. Free tickets are still available.</p>
      ) : null}
      {allSoldOut ? (
        <p className="text-sm text-ink-soft">Tickets held in someone&apos;s checkout may come back within 30 minutes.</p>
      ) : null}

      {selected ? (
        <>
          <div className="w-40">
            <TextInput
              disabled={leaving}
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
          {validQuantity ? (
            <p className="flex justify-between gap-3 border-t border-line pt-4 text-sm text-ink-soft">
              <span>{quantity} × {selected.name}</span>
              <span className="font-semibold tabular-nums text-ink">{formatPrice(selected.price * quantity)}</span>
            </p>
          ) : null}
        </>
      ) : null}

      {allSoldOut || !selected ? null : action}
    </Box>
  );
}
