"use client";

import { commerceHoldMinutes } from "@/lib/checkout-hold";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { GuestEmailForm } from "@/components/guest/guest-email-form";
import { CheckoutShell } from "@/components/layout/checkout-shell";
import { useBasket } from "@/components/merchandise/shop";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Notice } from "@/components/ui/notice";
import { PhoneActionBar, useActionBelow } from "@/components/purchases/phone-action-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientApiError, fetchJson, getClientErrorMessage } from "@/lib/client/api";
import { useCheckout, type CheckoutResponse } from "@/lib/client/checkout";
import { formatMoney, formatPrice, payLabel } from "@/lib/format";
import { readBasket, writeBasket } from "@/lib/merchandise/basket";
import type { Quote } from "@/lib/merchandise/shop";

const linkClass = "inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4";
const items = (count: number) => `${count} ${count === 1 ? "item" : "items"}`;

type Buyer = { name: string | null; email: string; guest: boolean };
type Refusal = { title: string; body: string; toBasket?: boolean; openOrder?: string };

// BUY-07 (T27b, design round B2): review and pay for one society's basket.
// The basket is on this device, so the review re-quotes it; a basket that
// changed since it was last shown goes back to the basket page to be fixed,
// and checkout re-checks everything under locks.
export function MerchandiseCheckout({
  society,
  organisationId,
  logoAssetId,
  buyer,
  guestCsrf,
  callbackUrl
}: {
  society: { slug: string; name: string };
  organisationId: string;
  logoAssetId: string | null;
  // Null: a signed-out visitor, who confirms an email first.
  buyer: Buyer | null;
  guestCsrf?: string;
  callbackUrl: string;
}) {
  const router = useRouter();
  const { basket, ready } = useBasket();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState("");
  const [actionRef, actionBelow] = useActionBelow<HTMLDivElement>();
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const { state, start } = useCheckout({
    finished: (orderId) => router.push(`/merchandise/orders/${encodeURIComponent(orderId)}`),
    slow: () => setRefusal({ title: "Still confirming", body: "Stripe hasn't answered yet. You won't be charged twice; try again in a minute." }),
    refused: (failure) => setRefusal(refusalFor(failure))
  });
  const lines = basket && basket.society === society.slug ? basket.lines : null;
  const linesKey = JSON.stringify(lines);
  const basketHref = `/societies/${society.slug}/merchandise/basket`;

  const requote = useCallback(async () => {
    const current = JSON.parse(linesKey);
    if (!current?.length) return;
    try {
      const response = await fetchJson<{ quote: Quote }>("/api/merchandise/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ society: society.slug, items: current })
      });
      setQuote(response.quote);
      setError("");
    } catch (failure) {
      setError(getClientErrorMessage(failure, "We couldn't check your basket. Try again."));
    }
  }, [linesKey, society.slug]);

  useEffect(() => {
    if (ready) void requote();
  }, [ready, requote]);

  function pay(current: Quote) {
    setRefusal(null);
    return start((idempotencyKey) => fetchJson<CheckoutResponse>("/api/payments/checkout/merchandise", {
      method: "POST",
      headers: { "content-type": "application/json", ...(guestCsrf ? { "x-thunderstrux-guest-csrf": guestCsrf } : {}) },
      body: JSON.stringify({
        organisationId,
        selection: { items: current.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })), quoteVersion: current.version },
        expectedTotal: current.total,
        idempotencyKey
      })
    }));
  }

  function refusalFor(failure: unknown): Refusal {
    const detail = failure instanceof ClientApiError ? failure.payload?.error?.details?.[0] : undefined;
    // A member opens the open order to pay or cancel it; a guest's may belong to an earlier email link.
    if (detail?.reason === "purchase_in_progress") return { title: "You already have a checkout in progress", body: `Finish paying for it or cancel it, then try again. An unpaid checkout ends on its own after ${commerceHoldMinutes} minutes. Nothing has been charged.`, openOrder: guestCsrf ? undefined : detail.id };
    if (detail?.reason === "free_limit_reached") return { title: "That's more than one person can get free", body: `${getClientErrorMessage(failure, "You've reached the limit on a free item.")} Nothing has been charged.`, toBasket: true };
    if (detail?.reason === "unavailable") return { title: "An item is no longer sold", body: "Remove it from your basket to continue. Nothing has been charged.", toBasket: true };
    if (detail?.reason === "sold_out" || detail?.reason === "not_enough" || detail?.reason === "quote_changed" || detail?.path?.[0] === "expectedTotal") {
      return { title: "Some items changed", body: "A price or stock level changed while you were checking out. Nothing has been charged.", toBasket: true };
    }
    return { title: "Checkout didn't start", body: `${getClientErrorMessage(failure, "Something went wrong.")} Nothing has been charged.` };
  }

  const shell = (title: string, steps: string[], current: number, children: ReactNode, aside?: ReactNode) => (
    <CheckoutShell lead="Buying from" aside={aside} backHref={basketHref} backLabel="Back to basket" current={current} society={society.name} steps={steps} title={title}>
      {children}
    </CheckoutShell>
  );

  if (!ready || (lines?.length && !quote && !error)) {
    return shell("Review your order", ["Review", "Pay with Stripe", "Pickup"], 0, <div className="grid gap-4">
      <p className="sr-only" role="status">Checking prices and stock…</p>
      <Skeleton className="h-40 rounded-card" />
      <Skeleton className="h-28 rounded-card" />
      <Skeleton className="h-28 rounded-card" />
    </div>);
  }
  if (!lines?.length) {
    return shell(
      "Your basket is empty",
      ["Review", "Pay with Stripe", "Pickup"],
      0,
      <Card>
        <div className="grid justify-items-start gap-3">
          <p className="text-ink-soft">Add something from {society.name}&apos;s merchandise first. Items you add stay on this device.</p>
          <Link className={buttonClasses({ variant: "secondary" })} href={`/societies/${society.slug}/merchandise`}>
            Browse merchandise
          </Link>
        </div>
      </Card>
    );
  }
  if (error || !quote) {
    return shell(
      "Review your order",
      ["Review", "Pay with Stripe", "Pickup"],
      0,
      <Notice role="alert" title="Not checked" tone="danger">
        <p className="mt-0.5">{error}</p>
        <Button className="mt-2" onClick={() => void requote()} variant="secondary">
          Try again
        </Button>
      </Notice>
    );
  }

  const free = quote.total === 0;
  const count = quote.lines.reduce((total, line) => total + line.quantity, 0);
  const steps = buyer?.guest || !buyer ? ["Your email", "Review", free ? "Pickup" : "Pay with Stripe"] : free ? ["Review", "Pickup"] : ["Review", "Pay with Stripe", "Pickup"];
  const summary = (
    <p className="flex justify-between gap-3 border-t border-line pt-3 text-ui text-ink">
      <span className="[overflow-wrap:anywhere]">
        {items(count)} from {society.name}
      </span>
      <strong className="tabular-nums">{formatPrice(quote.total)}</strong>
    </p>
  );

  if (!buyer) {
    return shell(
      "Where should we send your receipt?",
      steps,
      0,
      <Card>
        <div className="grid gap-4">
          <GuestEmailForm callbackUrl={callbackUrl} endpoint="/api/guest/email/request" submitLabel="Email me a link" />
          {summary}
        </div>
      </Card>
    );
  }

  // Anything the basket page would flag (sold out, fewer left, no longer sold) is fixed there first.
  const changed = quote.problems.length > 0 || quote.lines.length !== lines.length;
  const label = free ? "Confirm free order" : payLabel(quote.total);
  const aside = (
    <Card>
      <div className="grid gap-4">
        <div className="flex items-center gap-3">
          {logoAssetId ? (
            <img alt="" className="size-12 shrink-0 rounded-control border border-line bg-surface object-contain" height={48} src={`/api/public/assets/${logoAssetId}`} width={48} />
          ) : (
            <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-control border border-line font-display text-xl font-semibold text-brand-ink">
              {society.name.trim().charAt(0).toUpperCase()}
            </span>
          )}
          <div className="grid min-w-0">
            <h2 className="text-lg font-semibold text-ink">Merchandise order</h2>
            <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
              {society.name} · {items(count)}
            </p>
          </div>
        </div>
        <div className="flex items-baseline justify-between border-t border-line pt-3">
          <span className="font-semibold text-ink">Total</span>
          <span className="text-lg font-semibold tabular-nums text-ink">{formatPrice(quote.total)}</span>
        </div>
        {changed ? (
          <Notice title="Your basket changed since you added these" tone="warning">
            <p className="mt-0.5">We checked the latest prices and stock. Review your basket before you check out. Nothing has been charged.</p>
            <Link className={linkClass} href={basketHref}>
              Review basket
            </Link>
          </Notice>
        ) : (
          <>
            <div className="grid" ref={actionRef}>
              <Button busy={state !== "idle"} busyLabel={state === "confirming" ? "Confirming…" : free ? "Confirming…" : "Opening Stripe…"} onClick={() => void pay(quote)} size="lg" type="button">
                {label}
              </Button>
            </div>
            <PhoneActionBar show={actionBelow} summary={<span className="text-lg font-semibold tabular-nums text-ink">{free ? "Free" : formatMoney(quote.total)}</span>}>
              <Button busy={state !== "idle"} busyLabel={state === "confirming" ? "Confirming…" : free ? "Confirming…" : "Opening Stripe…"} onClick={() => void pay(quote)} size="lg" type="button">
                {label}
              </Button>
            </PhoneActionBar>
            {refusal ? (
              <Notice reveal role="alert" title={refusal.title} tone="warning">
                <p className="mt-0.5">{refusal.body}</p>
                {refusal.toBasket ? (
                  <Link className={linkClass} href={basketHref}>
                    Review basket
                  </Link>
                ) : null}
                {refusal.openOrder ? (
                  <Link className={linkClass} href={`/merchandise/orders/${encodeURIComponent(refusal.openOrder)}`}>
                    Open your checkout
                  </Link>
                ) : null}
              </Notice>
            ) : null}
            {state === "confirming" ? (
              <Notice reveal role="status" title="Confirming checkout…">
                <p className="mt-0.5">We&apos;re waiting for Stripe to answer. This moves on by itself; you won&apos;t be charged twice.</p>
              </Notice>
            ) : null}
          </>
        )}
        {free ? (
          <p className="text-caption text-ink-muted">Nothing to pay.</p>
        ) : (
          <p className="flex items-start gap-2 text-caption text-ink-muted">
            <Icon className="mt-0.5" name="lock" size={16} />
            You pay on Stripe&apos;s secure page, then come back here.
          </p>
        )}
      </div>
    </Card>
  );

  return shell(
    free ? "Confirm your order" : "Review your order",
    steps,
    buyer.guest ? 1 : 0,
    <>
      <Card>
        <div className="grid gap-4">
          <h2 className="text-lg font-semibold text-ink">Your items</h2>
          <ul className="grid gap-3 text-ui">
            {quote.lines.map((line) => (
              <li className="flex items-start justify-between gap-4" key={line.variantId}>
                <span className="grid">
                  <strong className="text-ink [overflow-wrap:anywhere]">
                    {line.quantity} × {line.name}
                  </strong>
                  {line.option || line.unitPrice ? (
                    <span className="text-sm text-ink-soft">{[line.option, line.unitPrice ? `${formatMoney(line.unitPrice)} each` : ""].filter(Boolean).join(" · ")}</span>
                  ) : null}
                </span>
                <span className="tabular-nums text-ink">{formatPrice(line.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <p className="flex items-baseline justify-between gap-4 border-t border-line pt-3">
            <span className="font-semibold text-ink">Total</span>
            <span className="text-lg font-semibold tabular-nums text-ink">{free ? "Free" : `${formatMoney(quote.total)} AUD`}</span>
          </p>
          <p className="text-sm text-ink-soft">{free ? "No payment needed." : "No booking fee. You pay the prices shown."}</p>
        </div>
      </Card>
      <Card>
        <div className="grid gap-2">
          <h2 className="text-lg font-semibold text-ink">Pickup, no delivery</h2>
          {quote.pickupPolicy ? <p className="whitespace-pre-wrap text-ui text-ink [overflow-wrap:anywhere]">{quote.pickupPolicy}</p> : null}
          <p className="text-sm text-ink-soft">Bring your order reference when you collect.</p>
        </div>
      </Card>
      <Card>
        <div className="grid gap-2">
          <h2 className="text-lg font-semibold text-ink">Receipt goes to</h2>
          <p className="text-ui text-ink [overflow-wrap:anywhere]">
            {buyer.name ? `${buyer.name} · ` : ""}
            {buyer.email}
            {buyer.guest ? <span className="ml-2 text-sm font-semibold text-success">Confirmed</span> : null}
          </p>
          {buyer.guest ? <p className="text-sm text-ink-soft">Buying as a guest. Your receipt email has your order reference and a link back to this order. Lost it later? <Link className="text-brand underline underline-offset-4" href="/guest/recover">Find your purchase</Link> with this address.</p> : null}
        </div>
      </Card>
      <Card>
        <div className="grid gap-2">
          <h2 className="text-lg font-semibold text-ink">Before you {free ? "confirm" : "pay"}</h2>
          <ul className="grid list-disc gap-1.5 pl-5 text-ui text-ink-soft">
            {free ? null : <li>We hold these items for {commerceHoldMinutes} minutes while you pay.</li>}
            {quote.refundPolicy ? <li className="whitespace-pre-wrap [overflow-wrap:anywhere]">Refund policy: {quote.refundPolicy}</li> : null}
            {quote.supportEmail ? (
              <li className="[overflow-wrap:anywhere]">
                Questions:{" "}
                <a className="font-semibold text-brand underline" href={`mailto:${quote.supportEmail}`}>
                  {quote.supportEmail}
                </a>
              </li>
            ) : null}
          </ul>
        </div>
      </Card>
    </>,
    aside
  );
}

// On the order page once it is paid: the basket bought is done with.
export function ClearBasket({ society }: { society: string }) {
  useEffect(() => {
    if (readBasket()?.society === society) writeBasket(null);
  }, [society]);
  return null;
}
