"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

// "Can't go?" on a free registration before the event (EVT-005), as Luma and
// Humanitix offer: the buyer releases it and the places go back on sale.
// After it, the page reloads from the server, which shows the cancellation.
export function ReleaseRegistration({ orderId, event, ticketCount, guestCsrf }: { orderId: string; event: string; ticketCount: number; guestCsrf?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const places = ticketCount === 1 ? "your place" : `your ${ticketCount} places`;

  async function release() {
    setBusy(true);
    setError("");
    try {
      await fetchJson(`/api/purchases/tickets/${orderId}/cancel-registration`, { method: "POST", headers: guestCsrf ? { "x-thunderstrux-guest-csrf": guestCsrf } : {} });
      setOpen(false);
      router.refresh();
    } catch (failure) {
      setError(getClientErrorMessage(failure, "We couldn't cancel your registration. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2">
      <p className="text-sm text-ink-soft">Can&apos;t go? Cancel and {places} {ticketCount === 1 ? "goes" : "go"} to someone else.</p>
      <Button className="w-fit" onClick={() => setOpen(true)} type="button" variant="secondary">Cancel my registration</Button>
      {error ? <Notice role="alert" title="Couldn't cancel" tone="danger"><p>{error}</p></Notice> : null}
      <ConfirmDialog busy={busy} cancelLabel="Keep my place" confirmLabel="Cancel registration" destructive onCancel={() => setOpen(false)} onConfirm={release} open={open} title={`Cancel your registration for ${event}?`}>
        <p>Your {ticketCount === 1 ? "ticket stops" : "tickets stop"} working and {places} {ticketCount === 1 ? "goes" : "go"} back on sale. You can register again while places are left.</p>
      </ConfirmDialog>
    </div>
  );
}
