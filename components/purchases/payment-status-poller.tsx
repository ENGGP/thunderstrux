"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/ui/notice";

const intervalMs = 3000;
const maxChecks = 20;

// While Stripe's confirmation is on its way, check the order's status every
// few seconds and refresh the page once it changes. After about a minute it
// stops and says so; it never claims success itself. A membership order
// (T24a) passes its commerce order's status URL, whose pending is "processing".
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
      else timer = setTimeout(check, intervalMs);
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
