"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { fetchWithCsrf } from "@/lib/client/api";

export function OrderDetailActions({
  orderId,
  stripeSessionId,
  isManuallyRefunded,
  canResendTickets,
  requiresCompensationReview
}: {
  orderId: string;
  stripeSessionId: string | null;
  isManuallyRefunded: boolean;
  canResendTickets: boolean;
  requiresCompensationReview: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [refundId, setRefundId] = useState("");

  async function confirmCompensationRefund() {
    setIsBusy(true);
    setMessage(null);
    try {
      const response = await fetchWithCsrf(
        `/api/orders/${orderId}/compensation-refund/confirm`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refundId })
        }
      );
      if (!response.ok) {
        setMessage("The Stripe refund could not be verified for this order.");
        return;
      }
      setMessage("Stripe refund verified and compensation resolved.");
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  async function markRefunded() {
    setIsBusy(true);
    setMessage(null);

    try {
      const response = await fetchWithCsrf(`/api/orders/${orderId}/refund-manual`, {
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
      const response = await fetchWithCsrf(`/api/orders/${orderId}/resend`, {
        method: "POST"
      });

      if (!response.ok) {
        setMessage("Could not queue ticket resend.");
        return;
      }

      setMessage("Ticket resend queued.");
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
      {requiresCompensationReview ? (
        <>
          <input
            aria-label="Stripe refund ID"
            className="h-10 rounded-md border border-neutral-300 px-3 text-sm"
            onChange={(event) => setRefundId(event.target.value)}
            placeholder="re_..."
            value={refundId}
          />
          <Button
            disabled={isBusy || !refundId.trim()}
            onClick={confirmCompensationRefund}
            type="button"
          >
            Verify completed refund
          </Button>
        </>
      ) : (
        <Button
          disabled={isBusy || isManuallyRefunded}
          onClick={markRefunded}
          type="button"
          variant={isManuallyRefunded ? "secondary" : "primary"}
        >
          {isManuallyRefunded ? "Refund marked" : "Mark as refunded (manual)"}
        </Button>
      )}
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
