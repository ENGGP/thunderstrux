"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchWithCsrf } from "@/lib/client/api";

export function OrderDetailActions({
  orderId,
  buyerEmail,
  stripeSessionId,
  stripeDashboardUrl,
  isManuallyRefunded,
  canResendTickets,
  requiresCompensationReview,
  free = false
}: {
  orderId: string;
  buyerEmail: string | null;
  stripeSessionId: string | null;
  stripeDashboardUrl: string | null;
  isManuallyRefunded: boolean;
  canResendTickets: boolean;
  requiresCompensationReview: boolean;
  // A free registration charged nothing: no refund to record and no Stripe session.
  free?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [confirmingRefund, setConfirmingRefund] = useState(false);
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
        setMessage({ ok: false, text: "The Stripe refund could not be verified for this order." });
        return;
      }
      setMessage({ ok: true, text: "Stripe refund verified and compensation resolved." });
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
        setMessage({ ok: false, text: "Could not update refund flag." });
        return;
      }

      setMessage({ ok: true, text: "Marked as refunded." });
      router.refresh();
    } finally {
      setIsBusy(false);
      setConfirmingRefund(false);
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
        setMessage({ ok: false, text: "Could not queue ticket resend." });
        return;
      }

      setMessage({ ok: true, text: "Ticket resend queued." });
    } finally {
      setIsBusy(false);
    }
  }

  async function copyStripeSessionId() {
    if (!stripeSessionId) {
      return;
    }

    await navigator.clipboard.writeText(stripeSessionId);
    setMessage({ ok: true, text: "Stripe session ID copied." });
  }

  const block = "grid gap-2 border-t border-line pt-4";

  return (
    <div className="mt-4 grid gap-4">
      {message ? (
        <Notice role={message.ok ? "status" : "alert"} tone={message.ok ? "success" : "danger"}>
          {message.text}
        </Notice>
      ) : null}

      <div className="grid gap-2">
        <p className="font-semibold text-ink">Ticket email</p>
        <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
          {canResendTickets
            ? `Send the tickets to ${buyerEmail ?? "the buyer"} again.`
            : "No tickets have been issued for this order, so there is nothing to resend."}
        </p>
        <div>
          <Button disabled={isBusy || !canResendTickets} onClick={resendTickets} type="button" variant="secondary">
            Resend tickets
          </Button>
        </div>
      </div>

      {free ? (
        <div className={block}>
          <p className="font-semibold text-ink">Free registration</p>
          <p className="text-sm text-ink-soft">Nothing was charged, so there is no payment or refund to manage.</p>
        </div>
      ) : requiresCompensationReview ? (
        <div className={block}>
          <p className="font-semibold text-ink">Refund through Stripe</p>
          <p className="text-sm text-ink-soft">
            After refunding the buyer in Stripe, enter the refund ID so Thunderstrux can check it.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-64">
              <TextInput
                label="Stripe refund ID"
                onChange={(event) => setRefundId(event.target.value)}
                placeholder="re_..."
                value={refundId}
              />
            </div>
            <Button disabled={isBusy || !refundId.trim()} onClick={confirmCompensationRefund} type="button">
              Verify completed refund
            </Button>
          </div>
        </div>
      ) : (
        <div className={block}>
          <p className="font-semibold text-ink">Refund recorded outside Thunderstrux</p>
          {isManuallyRefunded ? (
            <p className="text-sm text-ink-soft">This order is marked as refunded.</p>
          ) : (
            <>
              <p className="text-sm text-ink-soft">
                Use only after you have refunded the buyer yourself. This records it and
                cannot be undone; it does not send money.
              </p>
              <div>
                <Button disabled={isBusy} onClick={() => setConfirmingRefund(true)} type="button" variant="danger">
                  Mark as refunded
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {free ? null : <div className={`${block} sm:flex sm:flex-wrap sm:items-center sm:gap-3`}>
        <span className="text-sm text-ink-soft">Stripe session</span>
        <code className="rounded-control bg-surface-subtle px-2 py-1 text-sm text-ink [overflow-wrap:anywhere]">
          {stripeSessionId ?? "Not available"}
        </code>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!stripeSessionId} onClick={copyStripeSessionId} size="sm" type="button" variant="tertiary">
            Copy session ID
          </Button>
          {stripeDashboardUrl ? (
            <a
              className="text-sm font-semibold text-brand underline underline-offset-4"
              href={stripeDashboardUrl}
              rel="noreferrer"
              target="_blank"
            >
              View in Stripe
            </a>
          ) : null}
        </div>
      </div>}

      <ConfirmDialog
        busy={isBusy}
        confirmLabel="Mark as refunded"
        destructive
        onCancel={() => setConfirmingRefund(false)}
        onConfirm={markRefunded}
        open={confirmingRefund}
        title="Mark this order as refunded?"
      >
        Do this only after you have refunded the buyer yourself. It records the refund
        on this order and cannot be undone. It does not send money or change the payment
        in Stripe.
      </ConfirmDialog>
    </div>
  );
}
