"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

// Add to my account: an explicit, confirmed step; nothing claims a guest order by itself.
export function GuestClaim({ orderId, email, summary }: { orderId: string; email: string; summary: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function claim() {
    setBusy(true);
    setError("");
    try {
      await fetchJson(`/api/guest/orders/${encodeURIComponent(orderId)}/claim`, { method: "POST" });
      setOpen(false);
      setDone(true);
      router.refresh();
    } catch (failure) {
      setOpen(false);
      setError(getClientErrorMessage(failure, "We couldn't add this order. Try again."));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Notice role="status" title="Added to your account" tone="success">
        <p>Find these tickets in <Link className="font-semibold text-brand underline underline-offset-4" href="/tickets">My tickets</Link> from now on.</p>
      </Notice>
    );
  }

  return (
    <>
      {error ? <Notice role="alert" tone="danger">{error}</Notice> : null}
      <Notice title="Add this order to your account?">
        <p className="[overflow-wrap:anywhere]">You bought it as a guest with {email}, the email on your account. Once added, its tickets show in My tickets.</p>
        <Button className="mt-2" onClick={() => setOpen(true)} type="button">Add to my account</Button>
      </Notice>
      <ConfirmDialog busy={busy} confirmLabel="Add to my account" onCancel={() => setOpen(false)} onConfirm={claim} open={open} title="Add to your account?">
        <p className="[overflow-wrap:anywhere]">{summary} will move into My tickets for {email}. This can&apos;t be undone, and the receipt email stays the same.</p>
      </ConfirmDialog>
    </>
  );
}
