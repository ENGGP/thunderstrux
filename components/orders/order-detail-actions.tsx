"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextArea, TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, fetchWithCsrf, getClientErrorMessage } from "@/lib/client/api";

export function OrderDetailActions({
  refund = null,
  orderId,
  buyerEmail,
  stripeSessionId,
  stripeDashboardUrl,
  isManuallyRefunded,
  canResendTickets,
  requiresCompensationReview,
  free = false,
  disputed = false,
  cancelFree = null,
  markNeedsCode = false
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
  // A buyer's dispute pauses resends and every refund action until it is resolved.
  disputed?: boolean;
  // Set when this staff member may cancel this free registration; cancelled once it has been.
  cancelFree?: { buyer: string; ticketCount: number; needsCode: boolean; cancelled: boolean } | null;
  // Set when this staff member may refund this order through Stripe.
  // rest: part of the order was already refunded in Stripe; this refunds what is left.
  refund?: { amount: string; rest?: boolean; buyer: string; reference: string; ticketCount: number; needsCode: boolean } | null;
  // Marking a refund made outside Thunderstrux, or confirming one made in Stripe (SEC-036), asks for a
  // fresh authenticator code unless staff MFA is off.
  markNeedsCode?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [confirmingRefund, setConfirmingRefund] = useState(false);
  const [refundId, setRefundId] = useState("");
  const [refunding, setRefunding] = useState(false);
  const [refundForm, setRefundForm] = useState({ reason: "", confirmation: "", mfaCode: "" });
  const [refundError, setRefundError] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // One form and error for both dialogs: only one is ever open.
  async function cancelRegistration() {
    setIsBusy(true);
    setRefundError("");
    try {
      await fetchJson(`/api/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: refundForm.reason, ...(cancelFree?.needsCode ? { mfaCode: refundForm.mfaCode } : {}) })
      });
      setCancelling(false);
      router.refresh();
    } catch (failure) {
      setRefundError(getClientErrorMessage(failure, "The registration wasn't cancelled. Nothing changed."));
    } finally {
      setIsBusy(false);
    }
  }

  async function refundOrder() {
    setIsBusy(true);
    setRefundError("");
    try {
      await fetchJson(`/api/orders/${orderId}/refunds`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: refundForm.reason, confirmation: refundForm.confirmation, ...(refund?.needsCode ? { mfaCode: refundForm.mfaCode } : {}) })
      });
      setRefunding(false);
      router.refresh();
    } catch (failure) {
      setRefundError(getClientErrorMessage(failure, "The refund couldn't start. Nothing was refunded."));
    } finally {
      setIsBusy(false);
    }
  }

  async function confirmCompensationRefund() {
    setIsBusy(true);
    setMessage(null);
    try {
      await fetchJson(`/api/orders/${orderId}/compensation-refund/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refundId, ...(markNeedsCode ? { mfaCode: refundForm.mfaCode } : {}) })
      });
      setMessage({ ok: true, text: "Stripe refund verified and compensation resolved." });
      router.refresh();
    } catch (failure) {
      // Says what is missing, such as a transfer not reversed (PAY-027) or the code.
      setMessage({ ok: false, text: getClientErrorMessage(failure, "The Stripe refund could not be verified for this order.") });
    } finally {
      setIsBusy(false);
    }
  }

  async function markRefunded() {
    setIsBusy(true);
    setRefundError("");
    try {
      await fetchJson(`/api/orders/${orderId}/refund-manual`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(markNeedsCode ? { mfaCode: refundForm.mfaCode } : {})
      });
      setConfirmingRefund(false);
      setMessage({ ok: true, text: "Marked as refunded." });
      router.refresh();
    } catch (failure) {
      setRefundError(getClientErrorMessage(failure, "The order wasn't marked. Nothing changed."));
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
          {disputed
            ? "Resends are paused while the payment is disputed."
            : cancelFree?.cancelled
            ? "The registration was cancelled, so its tickets are no longer valid and can't be resent."
            : canResendTickets
            ? `Send the tickets to ${buyerEmail ?? "the buyer"} again.`
            : "No tickets have been issued for this order, so there is nothing to resend."}
        </p>
        <div>
          <Button disabled={isBusy || !canResendTickets || disputed} onClick={resendTickets} type="button" variant="secondary">
            Resend tickets
          </Button>
        </div>
      </div>

      {free ? (
        <div className={block}>
          <p className="font-semibold text-ink">Free registration</p>
          <p className="text-sm text-ink-soft">
            {cancelFree?.cancelled
              ? "This registration was cancelled. Nothing was charged, so there is nothing to refund."
              : "Nothing was charged, so there is no payment or refund to manage. Owners and finance managers can cancel the registration."}
          </p>
          {cancelFree && !cancelFree.cancelled ? (
            <div>
              <Button disabled={isBusy} onClick={() => setCancelling(true)} type="button" variant="danger">
                Cancel registration
              </Button>
            </div>
          ) : null}
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
            {markNeedsCode ? (
              <div className="w-full sm:w-48">
                <TextInput autoComplete="one-time-code" inputMode="numeric" label="Authenticator code" onChange={(event) => setRefundForm({ ...refundForm, mfaCode: event.target.value })} value={refundForm.mfaCode} />
              </div>
            ) : null}
            <Button disabled={isBusy || !refundId.trim() || (markNeedsCode && !refundForm.mfaCode.trim())} onClick={confirmCompensationRefund} type="button">
              Verify completed refund
            </Button>
          </div>
        </div>
      ) : disputed ? null : (
        <>
        {refund ? (
          <div className={block}>
            <p className="font-semibold text-ink">Refund through Stripe</p>
            <p className="text-sm text-ink-soft">
              {refund.rest ? `Refunds the ${refund.amount} not yet refunded in Stripe.` : "Refunds the whole order to the buyer’s card."} Owners and finance managers can refund.
            </p>
            <div>
              <Button disabled={isBusy} onClick={() => setRefunding(true)} type="button" variant="danger">
                {refund.rest ? "Refund the rest" : "Refund whole order"}
              </Button>
            </div>
          </div>
        ) : null}
        <div className={block}>
          <p className="font-semibold text-ink">Refund recorded outside Thunderstrux</p>
          {isManuallyRefunded ? (
            <p className="text-sm text-ink-soft">This order is marked as refunded.</p>
          ) : (
            <>
              <p className="text-sm text-ink-soft">
                Use only after you have refunded the buyer yourself. This records it, stops the
                tickets working and cannot be undone; it does not send money.
              </p>
              <div>
                <Button disabled={isBusy} onClick={() => setConfirmingRefund(true)} type="button" variant="danger">
                  Mark as refunded
                </Button>
              </div>
            </>
          )}
        </div>
        </>
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

      {refund ? (
        <ConfirmDialog
          busy={isBusy}
          confirmLabel={`Refund ${refund.amount}`}
          destructive
          onCancel={() => setRefunding(false)}
          onConfirm={refundOrder}
          open={refunding}
          title={`Refund ${refund.amount} to ${refund.buyer}?`}
        >
          <div className="grid gap-3">
            {refundError ? <Notice role="alert" tone="danger">{refundError}</Notice> : null}
            <ul className="grid list-disc gap-1 pl-5">
              <li>{refund.ticketCount === 1 ? "The ticket stops" : `All ${refund.ticketCount} tickets stop`} working straight away.</li>
              <li>Anyone already checked in stays in the attendance record.</li>
              <li>The tickets don&apos;t go back on sale. You can add stock on the event if you want to.</li>
              <li>The refund comes out of the society&apos;s Stripe balance, and the Thunderstrux fee is returned too.</li>
            </ul>
            <TextInput hint="Recorded in the order history. 8 to 500 characters." label="Reason" maxLength={500} onChange={(event) => setRefundForm({ ...refundForm, reason: event.target.value })} value={refundForm.reason} />
            <TextInput autoComplete="off" label={`Type ${refund.reference} to confirm`} onChange={(event) => setRefundForm({ ...refundForm, confirmation: event.target.value })} value={refundForm.confirmation} />
            {refund.needsCode ? (
              <TextInput autoComplete="one-time-code" inputMode="numeric" label="Authenticator code" onChange={(event) => setRefundForm({ ...refundForm, mfaCode: event.target.value })} value={refundForm.mfaCode} />
            ) : null}
          </div>
        </ConfirmDialog>
      ) : null}

      {cancelFree && !cancelFree.cancelled ? (
        <ConfirmDialog
          busy={isBusy}
          cancelLabel="Keep registration"
          confirmLabel="Cancel registration"
          destructive
          onCancel={() => setCancelling(false)}
          onConfirm={cancelRegistration}
          open={cancelling}
          title={`Cancel ${cancelFree.buyer}'s free registration?`}
        >
          <div className="grid gap-3">
            {refundError ? <Notice role="alert" tone="danger">{refundError}</Notice> : null}
            <ul className="grid list-disc gap-1 pl-5">
              <li>{cancelFree.ticketCount === 1 ? "The free ticket stops" : `All ${cancelFree.ticketCount} free tickets stop`} working straight away, and the buyer is emailed.</li>
              <li>Anyone already checked in stays in the attendance record.</li>
              <li>The places don&apos;t go back on sale by themselves.</li>
            </ul>
            <TextArea hint="Recorded in the order history. 8 to 500 characters." label="Reason" maxLength={500} onChange={(event) => setRefundForm({ ...refundForm, reason: event.target.value })} rows={2} value={refundForm.reason} />
            {cancelFree.needsCode ? (
              <TextInput autoComplete="one-time-code" inputMode="numeric" label="Authenticator code" onChange={(event) => setRefundForm({ ...refundForm, mfaCode: event.target.value })} value={refundForm.mfaCode} />
            ) : null}
          </div>
        </ConfirmDialog>
      ) : null}

      <ConfirmDialog
        busy={isBusy}
        confirmLabel="Mark as refunded"
        destructive
        onCancel={() => setConfirmingRefund(false)}
        onConfirm={markRefunded}
        open={confirmingRefund}
        title="Mark this order as refunded?"
      >
        <div className="grid gap-3">
          {refundError ? <Notice role="alert" tone="danger">{refundError}</Notice> : null}
          <p>
            Do this only after you have refunded the buyer yourself. The tickets stop working straight away, and
            this can&apos;t be undone. It doesn&apos;t send money or change the payment in Stripe.
          </p>
          {markNeedsCode ? (
            <TextInput autoComplete="one-time-code" inputMode="numeric" label="Authenticator code" onChange={(event) => setRefundForm({ ...refundForm, mfaCode: event.target.value })} value={refundForm.mfaCode} />
          ) : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}
