"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

// Return to payment (the same Stripe page, so the same price and hold) and
// Cancel order, asked once (design round E1). After either outcome the page
// reloads from the server, which says what Stripe and the order now say.
export function UnpaidOrderActions({ cancelUrl, paymentUrl, confirmText, title, guestCsrf, stacked = false }: {
  cancelUrl: string;
  paymentUrl: string | null;
  // What the confirmation says happens, e.g. "The 1 ticket you're holding for Super launch goes back on sale."
  confirmText: string;
  title: string;
  guestCsrf?: string;
  stacked?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function cancel() {
    setBusy(true);
    setError("");
    try {
      await fetchJson(cancelUrl, { method: "POST", headers: guestCsrf ? { "x-thunderstrux-guest-csrf": guestCsrf } : {} });
      setOpen(false);
      router.refresh();
    } catch (failure) {
      setError(getClientErrorMessage(failure, "We couldn't cancel this order. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className={`flex gap-2.5 ${stacked ? "flex-col" : "flex-wrap"}`}>
        {paymentUrl ? <a className={buttonClasses({ size: stacked ? "lg" : "md" })} href={paymentUrl}>Return to payment</a> : null}
        <Button onClick={() => setOpen(true)} size={stacked ? "lg" : "md"} type="button" variant="secondary">Cancel order</Button>
      </div>
      {error ? <Notice role="alert" title="Couldn't cancel" tone="danger"><p>{error}</p></Notice> : null}
      <ConfirmDialog busy={busy} cancelLabel="Keep it" confirmLabel="Cancel order" destructive onCancel={() => setOpen(false)} onConfirm={cancel} open={open} title={title}>
        <p>{confirmText} Nothing has been charged.</p>
      </ConfirmDialog>
    </div>
  );
}
