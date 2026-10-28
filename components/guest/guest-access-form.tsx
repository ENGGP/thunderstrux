"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAccountLinkToken } from "@/components/auth/account-link-token";
import { Button, buttonClasses } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { ClientApiError, fetchJson, getClientErrorMessage } from "@/lib/client/api";

// The server refused the link itself; a timeout, rate limit or outage says nothing about it.
function linkRefused(failure: unknown) {
  return failure instanceof ClientApiError && failure.status >= 400 && failure.status < 500 && failure.status !== 408 && failure.status !== 429;
}

export function GuestAccessForm() {
  const router = useRouter();
  const [token, setToken, ready] = useAccountLinkToken();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true);
    try {
      const result = await fetchJson<{ callbackUrl: string }>("/api/guest/email/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token })
      });
      setToken("");
      router.replace(result.callbackUrl);
    } catch (failure) {
      if (linkRefused(failure)) {
        setToken("");
        setError(getClientErrorMessage(failure, "This link has stopped working."));
      } else {
        setError("We couldn't check your link just now. It still works, so try again.");
      }
      setBusy(false);
    }
  }

  // Until the link is read (always on the server render), say so at the size of
  // the Continue step, rather than flashing "stopped working" at a valid link.
  if (!ready) {
    return (
      <div className="grid gap-4">
        <p className="text-ink-soft">Checking your link…</p>
        <div aria-hidden="true" className="h-12" />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="grid gap-4">
        {error ? <Notice role="alert" tone="danger">{error}</Notice> : null}
        <h2 className="text-xl font-semibold text-ink">This link has stopped working</h2>
        {/* An order link is often tapped again at the door; finding the purchase is the way back, not a new order. */}
        <p className="text-ink-soft">
          Each link works once, for a short time. Already bought? We&apos;ll email you a new link to your order. Still buying? Go back to the event and enter your email again.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link className={buttonClasses({ size: "lg" })} href="/guest/recover">Find your purchase</Link>
          <Link className={buttonClasses({ size: "lg", variant: "secondary" })} href="/events">Back to events</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="text-ink-soft">Continue to confirm your email and go back to your order.</p>
      <Button busy={busy} busyLabel="Confirming…" onClick={confirm} size="lg" type="button">Continue</Button>
      {error ? <Notice reveal role="alert" tone="danger">{error}</Notice> : null}
    </div>
  );
}
