"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextArea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

// Staff decisions after a dispute or a refund made in Stripe (T18b). Neither moves money.
export function OrderReviewActions({ orderId, action }: { orderId: string; action: "restore_tickets" | "mark_reviewed" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    setBusy(true);
    setError("");
    try {
      await fetchJson(`/api/orders/${orderId}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "restore_tickets" ? { action, reason } : { action })
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
        {error ? <Notice role="alert" tone="danger">{error}</Notice> : null}
        <div><Button disabled={busy} onClick={send} size="sm" type="button" variant="secondary">Mark as reviewed</Button></div>
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
