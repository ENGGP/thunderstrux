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
        <p className="text-ink-soft">Links work once and only for 30 minutes. Go back to the event and enter your email again for a new one.</p>
        <Link className={buttonClasses({ size: "lg" })} href="/events">Back to events</Link>
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
