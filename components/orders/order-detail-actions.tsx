"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function OrderDetailActions({
  orderId,
  stripeSessionId,
  isManuallyRefunded,
  canResendTickets
}: {
  orderId: string;
  stripeSessionId: string | null;
  isManuallyRefunded: boolean;
  canResendTickets: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function markRefunded() {
    setIsBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/orders/${orderId}/refund-manual`, {
        method: "PATCH"
      });

      if (!response.ok) {
        setMessage("Could not update refund flag.");
        return;
      }

      setMessage("Marked as manually refunded.");
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  async function resendTickets() {
    setIsBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/orders/${orderId}/resend`, {
        method: "POST"
      });

      if (!response.ok) {
        setMessage("Could not queue ticket resend.");
        return;
      }

      setMessage("Ticket resend logged.");
    } finally {
      setIsBusy(false);
    }
  }

  async function copyStripeSessionId() {
    if (!stripeSessionId) {
      return;
    }

    await navigator.clipboard.writeText(stripeSessionId);
    setMessage("Stripe session ID copied.");
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        disabled={isBusy || isManuallyRefunded}
        onClick={markRefunded}
        type="button"
        variant={isManuallyRefunded ? "secondary" : "primary"}
      >
        {isManuallyRefunded ? "Refund marked" : "Mark as refunded (manual)"}
      </Button>
      <Button
        disabled={isBusy || !canResendTickets}
        onClick={resendTickets}
        type="button"
        variant="secondary"
      >
        Resend tickets
      </Button>
      <Button
        disabled={!stripeSessionId}
        onClick={copyStripeSessionId}
        type="button"
        variant="secondary"
      >
        Copy session ID
      </Button>
      {message ? <p className="text-sm text-neutral-600">{message}</p> : null}
    </div>
  );
}
