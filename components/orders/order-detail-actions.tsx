"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MoneyInput, TextArea, TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, fetchWithCsrf, getClientErrorMessage } from "@/lib/client/api";
import { formatMoney, formatMoneyInput, parseMoneyInput } from "@/lib/format";

// A ticket that can still be refunded or cancelled, as the staff order page lists it.
type RefundableTicket = { id: string; reference: string; type: string; checkedIn: boolean };

export function OrderDetailActions({
  refund = null,
  orderId,
  buyerEmail,
  stripeSessionId,
  stripeDashboardUrl,
  paid,
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
  // A checkout that didn't complete took no money, so there is no refund to record.
  paid: boolean;
  isManuallyRefunded: boolean;
  canResendTickets: boolean;
  requiresCompensationReview: boolean;
  // A free registration charged nothing: no refund to record and no Stripe session.
  free?: boolean;
  // A buyer's dispute pauses resends and every refund action until it is resolved.
  disputed?: boolean;
  // Set when this staff member may cancel this free registration; cancelled once it has been.
  cancelFree?: { buyer: string; ticketCount: number; needsCode: boolean; cancelled: boolean } | null;
  // Set when this staff member may refund or cancel this order's tickets (DEBT-002, as
  // Humanitix): `left` is what can still be refunded, in cents, and `tickets` the valid ones.
  refund?: { left: number; unitPrice: number; buyer: string; reference: string; needsCode: boolean; tickets: RefundableTicket[] } | null;
  // Marking a refund made outside Thunderstrux, or confirming one made in Stripe (SEC-036), asks for a
  // fresh authenticator code unless staff MFA is off.
  markNeedsCode?: boolean;
}) {
  const router = useRouter();
  // Each result names the action it answers and shows under that action, so the card never jumps.
  const [message, setMessage] = useState<{ ok: boolean; text: string; at: "resend" | "verify" | "mark" | "copy" } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [confirmingRefund, setConfirmingRefund] = useState(false);
  const [refundId, setRefundId] = useState("");
  const [refunding, setRefunding] = useState(false);
  const [refundForm, setRefundForm] = useState({ reason: "", confirmation: "", mfaCode: "" });
  const [refundError, setRefundError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  // The refund dialog: every valid ticket picked, for all it can refund, cancelled and emailed.
  const [picked, setPicked] = useState<string[]>(() => refund?.tickets.map((ticket) => ticket.id) ?? []);
  const capFor = (count: number) => (refund ? Math.min(count * refund.unitPrice, refund.left) : 0);
  const [amount, setAmount] = useState(() => formatMoneyInput(refund?.tickets.length ? capFor(refund.tickets.length) : refund?.left ?? 0));
  const [cancelTickets, setCancelTickets] = useState(true);
  const [notifyBuyer, setNotifyBuyer] = useState(true);
  const [buyerMessage, setBuyerMessage] = useState("");
  // With no valid ticket left, the dialog refunds what is left (the whole-order path).
  const byTicket = Boolean(refund?.tickets.length);
  const cap = byTicket ? capFor(picked.length) : refund?.left ?? 0;
  const cents = byTicket ? parseMoneyInput(amount) : refund?.left ?? 0;

  // Each opening starts from the tickets valid now: a refund or cancellation since changed them.
  function openRefund() {
    const all = refund?.tickets.map((ticket) => ticket.id) ?? [];
    setPicked(all);
    setAmount(formatMoneyInput(all.length ? capFor(all.length) : refund?.left ?? 0));
    setCancelTickets(true);
    setNotifyBuyer(true);
    setBuyerMessage("");
    setRefundForm({ ...refundForm, confirmation: "" });
    setRefundError("");
    setRefunding(true);
  }

  // Picking tickets resets the amount to their value, as Humanitix does; staff may lower it.
  function pick(id: string, on: boolean) {
    const next = refund ? refund.tickets.map((ticket) => ticket.id).filter((ticketId) => (ticketId === id ? on : picked.includes(ticketId))) : [];
    setPicked(next);
    setAmount(formatMoneyInput(capFor(next.length)));
  }

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
    if (byTicket) {
      const problem = picked.length === 0 ? "Pick at least one ticket."
        : cents === null ? "Enter the refund as dollars and cents, like 12.50."
        : cents > cap ? `Refund at most ${formatMoney(cap)} for the tickets picked.`
        : cents === 0 && !cancelTickets ? "Refund an amount, or cancel the tickets."
        : "";
      if (problem) {
        setRefundError(problem);
        return;
      }
    }
    setIsBusy(true);
    setRefundError("");
    try {
      await fetchJson(`/api/orders/${orderId}/refunds`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: refundForm.reason,
          confirmation: refundForm.confirmation,
          ...(refund?.needsCode ? { mfaCode: refundForm.mfaCode } : {}),
          ...(byTicket ? { ticketIds: picked, amount: cents, cancelTickets, notifyBuyer, ...(notifyBuyer && buyerMessage.trim() ? { buyerMessage } : {}) } : {})
        })
      });
      setRefunding(false);
      router.refresh();
    } catch (failure) {
      setRefundError(getClientErrorMessage(failure, "That didn't go through. Nothing was refunded or cancelled."));
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
      setMessage({ ok: true, text: "Stripe refund verified and compensation resolved.", at: "verify" });
      router.refresh();
    } catch (failure) {
      // Says what is missing, such as a transfer not reversed (PAY-027) or the code.
      setMessage({ ok: false, text: getClientErrorMessage(failure, "The Stripe refund could not be verified for this order."), at: "verify" });
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
        body: JSON.stringify({ reason: refundForm.reason, ...(markNeedsCode ? { mfaCode: refundForm.mfaCode } : {}) })
      });
      setConfirmingRefund(false);
      setMessage({ ok: true, text: "Marked as refunded.", at: "mark" });
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
        setMessage({ ok: false, text: "The tickets weren’t resent. Try again in a moment.", at: "resend" });
        return;
      }

      setMessage({ ok: true, text: "Ticket resend queued.", at: "resend" });
    } catch {
      setMessage({ ok: false, text: "We couldn’t reach Thunderstrux, so nothing was resent. Check your connection and try again.", at: "resend" });
    } finally {
      setIsBusy(false);
    }
  }

  async function copyStripeSessionId() {
    if (!stripeSessionId) {
      return;
    }

    try {
      await navigator.clipboard.writeText(stripeSessionId);
      setMessage({ ok: true, text: "Stripe session ID copied.", at: "copy" });
    } catch {
      setMessage({ ok: false, text: "Couldn’t copy it. Select the ID and copy it yourself.", at: "copy" });
    }
  }

  const block = "grid gap-2 border-t border-line pt-4";
  const result = (at: NonNullable<typeof message>["at"]) =>
    message?.at === at ? (
      <Notice reveal role={message.ok ? "status" : "alert"} tone={message.ok ? "success" : "danger"}>
        {message.text}
      </Notice>
    ) : null;

  return (
    <div className="mt-4 grid gap-4">
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
        {result("resend")}
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
            Refund the buyer in Stripe and this review closes by itself. If it doesn&apos;t, enter the refund ID so Thunderstrux can check it.
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
          {result("verify")}
        </div>
      ) : disputed ? null : (
        <>
        {refund ? (
          <div className={block}>
            <p className="font-semibold text-ink">Refund or cancel tickets</p>
            <p className="text-sm text-ink-soft">
              {refund.left > 0 ? `${formatMoney(refund.left)} can still be refunded to the buyer’s card.` : "Everything paid has been refunded."}{" "}
              {byTicket ? "Pick tickets, then refund all or part of their price, or cancel them without a refund." : "No ticket is still valid."} Owners and finance managers can do this.
            </p>
            <div>
              <Button disabled={isBusy} onClick={openRefund} type="button" variant="danger">
                {byTicket ? "Refund or cancel tickets" : "Refund the rest"}
              </Button>
            </div>
          </div>
        ) : null}
        {paid || isManuallyRefunded ? (
          <div className={block}>
            <p className="font-semibold text-ink">Refund recorded outside Thunderstrux</p>
            {isManuallyRefunded ? (
              <p className="text-sm text-ink-soft">This order is marked as refunded.</p>
            ) : (
              <>
                <p className="text-sm text-ink-soft">
                  Use only after you have refunded the buyer yourself. This records it, stops the
                  tickets working, puts their places back on sale and emails the buyer. It cannot be
                  undone and does not send money.
                </p>
                <div>
                  <Button disabled={isBusy} onClick={() => setConfirmingRefund(true)} type="button" variant="danger">
                    Mark as refunded
                  </Button>
                </div>
                {result("mark")}
              </>
            )}
          </div>
        ) : null}
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
        {result("copy")}
      </div>}

      {refund ? (
        <ConfirmDialog
          busy={isBusy}
          cancelLabel="Go back"
          // A fixed label, so the button keeps its size as staff change the amount; the summary says what happens.
          confirmLabel={byTicket ? "Confirm" : `Refund ${formatMoney(refund.left)}`}
          destructive
          onCancel={() => setRefunding(false)}
          onConfirm={refundOrder}
          open={refunding}
          title={byTicket ? `Refund or cancel ${refund.buyer}’s tickets?` : `Refund ${formatMoney(refund.left)} to ${refund.buyer}?`}
        >
          <div className="grid gap-4">
            {refundError ? <Notice role="alert" tone="danger">{refundError}</Notice> : null}
            {byTicket ? (
              <>
                <fieldset className="grid gap-1">
                  <legend className="mb-1 text-sm font-semibold text-ink">Tickets</legend>
                  {refund.tickets.map((ticket) => (
                    <label className="flex min-h-11 items-center gap-3" key={ticket.id}>
                      <input checked={picked.includes(ticket.id)} className="size-5 shrink-0 accent-brand" onChange={(event) => pick(ticket.id, event.target.checked)} type="checkbox" />
                      <span className="text-ink [overflow-wrap:anywhere]">
                        <span className="font-mono">{ticket.reference}</span> · {ticket.type}
                        {ticket.checkedIn ? <span className="text-ink-soft"> · Checked in</span> : null}
                      </span>
                    </label>
                  ))}
                </fieldset>
                <MoneyInput hint={`Up to ${formatMoney(cap)} for the tickets picked. $0 cancels them without a refund.`} label="Refund amount" onChange={setAmount} value={amount} />
                <label className="flex items-start gap-3">
                  <input checked={cancelTickets} className="mt-1 size-5 shrink-0 accent-brand" onChange={(event) => setCancelTickets(event.target.checked)} type="checkbox" />
                  <span className="grid">
                    <span className="font-semibold text-ink">Cancel these tickets</span>
                    <span className="text-sm text-ink-soft">They stop working and their places go back on sale, unless the event is cancelled. Anyone already checked in stays in the attendance record.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3">
                  <input checked={notifyBuyer} className="mt-1 size-5 shrink-0 accent-brand" onChange={(event) => setNotifyBuyer(event.target.checked)} type="checkbox" />
                  <span className="grid">
                    <span className="font-semibold text-ink">Email the buyer</span>
                    <span className="text-sm text-ink-soft">Says what was refunded and which tickets stop working.</span>
                  </span>
                </label>
                {notifyBuyer ? (
                  <TextArea hint="Optional. Added to the email. Up to 500 characters." label="Note to the buyer" maxLength={500} onChange={(event) => setBuyerMessage(event.target.value)} rows={2} value={buyerMessage} />
                ) : null}
              </>
            ) : (
              <p>No ticket is still valid, so this refunds the {formatMoney(refund.left)} left and the buyer is emailed.</p>
            )}
            <p className="text-sm text-ink-soft">A refund comes out of the society&apos;s Stripe balance, and the Thunderstrux fee on it is returned too.</p>
            <TextInput hint="Recorded in the order history. 8 to 500 characters." label="Reason" maxLength={500} onChange={(event) => setRefundForm({ ...refundForm, reason: event.target.value })} value={refundForm.reason} />
            <TextInput autoComplete="off" label={`Type ${refund.reference} to confirm`} onChange={(event) => setRefundForm({ ...refundForm, confirmation: event.target.value })} value={refundForm.confirmation} />
            {refund.needsCode ? (
              <TextInput autoComplete="one-time-code" inputMode="numeric" label="Authenticator code" onChange={(event) => setRefundForm({ ...refundForm, mfaCode: event.target.value })} value={refundForm.mfaCode} />
            ) : null}
            {byTicket && picked.length && cents !== null ? (
              <p className="font-semibold text-ink" aria-live="polite">
                {cents > 0 ? `Refund ${formatMoney(cents)}` : "No refund"}
                {cancelTickets ? ` and cancel ${refund.tickets.filter((ticket) => picked.includes(ticket.id)).map((ticket) => ticket.reference).join(", ")}` : "; the tickets stay valid"}.
                {notifyBuyer ? ` ${refund.buyer} gets an email.` : " No email to the buyer."}
              </p>
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
            Do this only after you have refunded the buyer yourself. The tickets stop working straight away, their
            places go back on sale unless the event is cancelled, and the buyer is emailed. This can&apos;t be
            undone. It doesn&apos;t send money or change the payment in Stripe.
          </p>
          <TextArea hint="How and when you refunded the buyer. Recorded in the order history. 8 to 500 characters." label="Reason" maxLength={500} onChange={(event) => setRefundForm({ ...refundForm, reason: event.target.value })} rows={2} value={refundForm.reason} />
          {markNeedsCode ? (
            <TextInput autoComplete="one-time-code" inputMode="numeric" label="Authenticator code" onChange={(event) => setRefundForm({ ...refundForm, mfaCode: event.target.value })} value={refundForm.mfaCode} />
          ) : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}
