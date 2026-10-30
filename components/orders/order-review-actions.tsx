"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextArea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

// Staff decisions after a dispute or a refund made in Stripe (T18b). Neither moves
// money. Reviewing a refund made in Stripe picks the tickets it covered (DEBT-002).
export function OrderReviewActions({
  orderId,
  action,
  tickets = [],
  preselect = 0
}: {
  orderId: string;
  action: "restore_tickets" | "mark_reviewed";
  tickets?: Array<{ id: string; reference: string; type: string }>;
  // How many tickets the refund covers whole, picked first.
  preselect?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<string[]>(() => tickets.slice(0, preselect).map((ticket) => ticket.id));

  async function send() {
    setBusy(true);
    setError("");
    try {
      await fetchJson(`/api/orders/${orderId}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "restore_tickets" ? { action, reason } : { action, ...(picked.length ? { ticketIds: picked } : {}) })
      });
      setOpen(false);
      router.refresh();
    } catch (failure) {
      setError(getClientErrorMessage(failure, "That didn't save. Nothing changed."));
    } finally {
      setBusy(false);
    }
  }

  if (action === "mark_reviewed") {
    return (
      <div className="grid gap-2">
        {tickets.length ? (
          <fieldset className="grid gap-1">
            <legend className="mb-1 text-sm font-semibold text-ink">Tickets the refund covered</legend>
            {tickets.map((ticket) => (
              <label className="flex min-h-11 items-center gap-3" key={ticket.id}>
                <input
                  checked={picked.includes(ticket.id)}
                  className="size-5 shrink-0 accent-brand"
                  onChange={(event) => setPicked(tickets.map((item) => item.id).filter((id) => (id === ticket.id ? event.target.checked : picked.includes(id))))}
                  type="checkbox"
                />
                <span className="text-ink"><span className="font-mono">{ticket.reference}</span> · {ticket.type}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {tickets.length ? <p className="text-sm text-ink-soft">{picked.length ? "The tickets picked stop working and go back on sale." : "None picked: every ticket stays valid."}</p> : null}
        {error ? <Notice role="alert" tone="danger">{error}</Notice> : null}
        <div>
          <Button disabled={busy} onClick={send} size="sm" type="button" variant="secondary">
            Mark as reviewed
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" type="button" variant="secondary">Restore tickets</Button>
      <ConfirmDialog busy={busy} confirmLabel="Restore tickets" onCancel={() => setOpen(false)} onConfirm={send} open={open} title="Restore the disputed tickets?">
        <div className="grid gap-3">
          {error ? <Notice role="alert" tone="danger">{error}</Notice> : null}
          <p>The tickets work again at the door. Your reason is kept in the order history.</p>
          <TextArea hint="8 to 500 characters." label="Reason" maxLength={500} onChange={(event) => setReason(event.target.value)} rows={2} value={reason} />
        </div>
      </ConfirmDialog>
    </>
  );
}
