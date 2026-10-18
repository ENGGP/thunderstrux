"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { ClientApiError, fetchJson, getClientErrorMessage } from "@/lib/client/api";
import { formatMoney } from "@/lib/format";

type CheckoutResponse = { kind: "stripe"; url: string } | { kind: "fulfilled"; commerceOrderId: string } | { attemptId: string; status: "processing" };
type AttemptStatus = { status: "processing" } | { status: "ready"; url: string } | { status: "completed"; orderId: string } | { status: "failed" };

const pollIntervalMs = 2000;
const pollAttempts = 15;
const linkClass = "inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4";

// Random bytes work outside secure contexts too, unlike crypto.randomUUID.
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");

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
  const key = useRef<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "confirming">("idle");
  const [refusal, setRefusal] = useState<{ title: string; body: string; link?: { href: string; label: string } } | null>(null);

  const finished = (orderId: string) => router.push(`/memberships/orders/${encodeURIComponent(orderId)}`);

  async function buy() {
    setRefusal(null);
    setState("busy");
    key.current ??= newKey();
    try {
      const data = await fetchJson<CheckoutResponse>("/api/payments/checkout/membership", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organisationId, selection: { planId }, expectedTotal: total, idempotencyKey: key.current })
      });
      if ("kind" in data && data.kind === "fulfilled") return finished(data.commerceOrderId);
      if ("kind" in data && data.kind === "stripe") {
        window.location.href = data.url;
        return;
      }
      await waitForCheckout(data.attemptId);
    } catch (failure) {
      setState("idle");
      // A server answer settles this intent; a lost response keeps the key so a retry finds the same checkout.
      if (failure instanceof ClientApiError) key.current = null;
      setRefusal(refusalFor(failure));
    }
  }

  // Stripe's answer was not known when checkout returned: poll the attempt.
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
      if (attempt.status === "failed") throw new Error("Checkout didn't start. Nothing has been charged.");
    }
    setState("idle");
    setRefusal({ title: "Still confirming", body: "Stripe hasn't answered yet. You won't be charged twice; try again in a minute.", link: { href: "/memberships", label: "View my memberships" } });
  }

  function refusalFor(failure: unknown) {
    const detail = failure instanceof ClientApiError ? failure.payload?.error?.details?.[0] : undefined;
    const reason = detail?.reason;
    if (reason === "term_overlap") return { title: "You already have a membership for these dates", body: "Nothing has been charged.", link: { href: "/memberships", label: "View my memberships" } };
    if (reason === "purchase_in_progress") return { title: "A checkout for these dates is already in progress", body: "Finish it or let it expire. Nothing more has been charged.", link: { href: "/memberships", label: "View my memberships" } };
    if (reason === "plan_unavailable") return { title: "This membership is no longer on sale", body: "Nothing has been charged.", link: { href: backHref, label: "See memberships" } };
    if (detail?.path?.[0] === "expectedTotal") {
      router.refresh();
      return { title: "The price changed", body: `It's now ${detail.value === 0 ? "free" : formatMoney(detail.value ?? 0)}. Nothing has been charged. Check the new price, then continue.` };
    }
    return { title: "Checkout didn't start", body: `${getClientErrorMessage(failure, "Something went wrong.")} Nothing has been charged.` };
  }

  return (
    <div className="grid gap-3">
      {refusal ? (
        <Notice role="alert" title={refusal.title} tone="warning">
          <p className="mt-0.5">{refusal.body}</p>
          {refusal.link ? (
            <Link className={linkClass} href={refusal.link.href}>
              {refusal.link.label}
            </Link>
          ) : null}
        </Notice>
      ) : null}
      {state === "confirming" ? (
        <Notice role="status" title="Confirming checkout…">
          <p className="mt-0.5">We&apos;re waiting for Stripe to answer. This moves on by itself; you won&apos;t be charged twice.</p>
        </Notice>
      ) : null}
      <Button disabled={state !== "idle"} onClick={buy} size="lg" type="button">
        {label}
      </Button>
    </div>
  );
}
