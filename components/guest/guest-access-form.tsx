"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAccountLinkToken } from "@/components/auth/account-link-token";
import { Button, buttonClasses } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

export function GuestAccessForm() {
  const router = useRouter();
  const [token, setToken] = useAccountLinkToken();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const result = await fetchJson<{ callbackUrl: string }>("/api/guest/email/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token })
      });
      setToken("");
      router.replace(result.callbackUrl);
    } catch (failure) {
      setToken("");
      setError(getClientErrorMessage(failure, "This link has stopped working."));
      setBusy(false);
    }
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
      <Button disabled={busy} onClick={confirm} size="lg" type="button">{busy ? "Confirming…" : "Continue"}</Button>
    </div>
  );
}
