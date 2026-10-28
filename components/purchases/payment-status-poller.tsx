"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/ui/notice";

const intervalMs = 3000;
const maxChecks = 20;
// After that, a webhook is late or lost; the reconciliation sweep (PAY-024) asks
// Stripe within a few minutes, so keep looking slowly for ten more minutes.
const slowIntervalMs = 15_000;
const maxSlowChecks = 40;

// While Stripe's confirmation is on its way, check the order's status every
// few seconds and refresh the page once it changes. After about a minute it
// says it is still confirming and keeps checking slowly; it never claims
// success itself. A membership or merchandise order passes its commerce
// order's status URL, whose pending is "pending".
export function PaymentStatusPoller({
  orderId,
  statusUrl = `/api/purchases/tickets/${orderId}/status`,
  slowMessage = "Stripe hasn't confirmed yet. If you paid, your tickets will appear in Purchases and My tickets when it does, and we'll email you."
}: {
  orderId: string;
  statusUrl?: string;
  slowMessage?: string;
}) {
  const router = useRouter();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let checks = 0;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    async function check() {
      checks += 1;
      try {
        const response = await fetch(statusUrl, { cache: "no-store" });
        const body = response.ok ? await response.json() : null;
        const status = body?.status ?? body?.order?.status;
        if (status && status !== "processing" && status !== "pending") {
          router.refresh();
          return;
        }
      } catch {
        // A dropped request is just another check; the next one tries again.
      }
      if (stopped) return;
      if (checks >= maxChecks) setSlow(true);
      if (checks < maxChecks + maxSlowChecks) timer = setTimeout(check, checks < maxChecks ? intervalMs : slowIntervalMs);
    }
    timer = setTimeout(check, intervalMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [statusUrl, router]);

  return slow ? (
    <Notice role="status" title="Still confirming">
      <p>{slowMessage}</p>
    </Notice>
  ) : null;
}
