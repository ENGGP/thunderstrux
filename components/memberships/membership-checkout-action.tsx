"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { PhoneActionBar, useActionBelow } from "@/components/purchases/phone-action-bar";
import { ClientApiError, fetchJson, getClientErrorMessage } from "@/lib/client/api";
import { useCheckout, type CheckoutResponse } from "@/lib/client/checkout";
import { formatMoney } from "@/lib/format";

const linkClass = "inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4";

// The review page's buy button (T24a). One key per purchase intent, so a
// double click or a lost answer finds the same checkout. Every refusal says
// nothing was charged; the screen is chosen from the detail's reason.
export function MembershipCheckoutAction({
  organisationId,
  planId,
  total,
  label,
  backHref
}: {
  organisationId: string;
  planId: string;
  total: number;
  label: string;
  backHref: string;
}) {
  const router = useRouter();
  const [actionRef, actionBelow] = useActionBelow<HTMLDivElement>();
  const [refusal, setRefusal] = useState<{ title: string; body: string; link?: { href: string; label: string } } | null>(null);
  const { state, start } = useCheckout({
    finished: (orderId) => router.push(`/memberships/orders/${encodeURIComponent(orderId)}`),
    slow: () => setRefusal({ title: "Still confirming", body: "Stripe hasn't answered yet. You won't be charged twice; try again in a minute.", link: { href: "/memberships", label: "View my memberships" } }),
    refused: (failure) => setRefusal(refusalFor(failure))
  });

  function buy() {
    setRefusal(null);
    return start((idempotencyKey) => fetchJson<CheckoutResponse>("/api/payments/checkout/membership", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organisationId, selection: { planId }, expectedTotal: total, idempotencyKey })
    }));
  }

  function refusalFor(failure: unknown) {
    const detail = failure instanceof ClientApiError ? failure.payload?.error?.details?.[0] : undefined;
    const reason = detail?.reason;
    if (reason === "term_overlap") return { title: "You already have a membership for these dates", body: "Nothing has been charged.", link: { href: "/memberships", label: "View my memberships" } };
    // The open order's page offers Return to payment and Cancel.
    if (reason === "purchase_in_progress") return { title: "A checkout for these dates is already in progress", body: "Finish it or cancel it. Nothing has been charged.", link: detail?.id ? { href: `/memberships/orders/${encodeURIComponent(detail.id)}`, label: "Open your checkout" } : { href: "/purchases?family=memberships", label: "Go to Purchases" } };
    if (reason === "plan_unavailable") return { title: "This membership is no longer on sale", body: "Nothing has been charged.", link: { href: backHref, label: "See memberships" } };
    if (detail?.path?.[0] === "expectedTotal") {
      router.refresh();
      return { title: "The price changed", body: `It's now ${detail.value === 0 ? "free" : formatMoney(detail.value ?? 0)}. Nothing has been charged. Check the new price, then continue.` };
    }
    return { title: "Checkout didn't start", body: `${getClientErrorMessage(failure, "Something went wrong.")} Nothing has been charged.` };
  }

  const payButton = (
    <Button busy={state !== "idle"} busyLabel={state === "confirming" || total === 0 ? "Confirming…" : "Opening Stripe…"} onClick={buy} size="lg" type="button">
      {label}
    </Button>
  );

  return (
    <div className="grid gap-3">
      <div className="grid" ref={actionRef}>{payButton}</div>
      <PhoneActionBar
        show={actionBelow}
        summary={<span className="text-lg font-semibold tabular-nums text-ink">{total === 0 ? "Free" : formatMoney(total)}</span>}
      >
        {payButton}
      </PhoneActionBar>
      {refusal ? (
        <Notice reveal role="alert" title={refusal.title} tone="warning">
          <p className="mt-0.5">{refusal.body}</p>
          {refusal.link ? (
            <Link className={linkClass} href={refusal.link.href}>
              {refusal.link.label}
            </Link>
          ) : null}
        </Notice>
      ) : null}
      {state === "confirming" ? (
        <Notice reveal role="status" title="Confirming checkout…">
          <p className="mt-0.5">We&apos;re waiting for Stripe to answer. This moves on by itself; you won&apos;t be charged twice.</p>
        </Notice>
      ) : null}
    </div>
  );
}
