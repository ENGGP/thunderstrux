"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/ui/notice";

const intervalMs = 3000;
const maxChecks = 20;

// While Stripe's confirmation is on its way, check the order's status every
// few seconds and refresh the page once it changes. After about a minute it
// stops and says so; it never claims success itself.
export function PaymentStatusPoller({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let checks = 0;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    async function check() {
      checks += 1;
      try {
        const response = await fetch(`/api/purchases/tickets/${orderId}/status`, { cache: "no-store" });
        if (response.ok && (await response.json()).status !== "processing") {
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
  }, [orderId, router]);

  return slow ? (
    <Notice role="status" title="Still confirming">
      <p>Stripe hasn&apos;t confirmed yet. If you paid, your tickets will appear in Purchases and My tickets when it does, and we&apos;ll email you.</p>
    </Notice>
  ) : null;
}
