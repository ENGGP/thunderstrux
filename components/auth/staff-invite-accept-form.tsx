"use client";
import Link from "next/link";
import { useState } from "react";
import { useAccountLinkToken } from "./account-link-token";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

export function StaffInviteAcceptForm() {
  const [token, setToken] = useAccountLinkToken();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  async function accept() {
    setBusy(true); setError(null);
    try {
      const result = await fetchJson<{ alreadyAccepted: boolean }>("/api/staff/invites/accept", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token })
      });
      setToken("");
      setStatus(result.alreadyAccepted ? "This invitation was already accepted. Your current access may have changed." :
        "Staff access accepted. Existing active staff roles were preserved. Choose your staff organisation on the dashboard.");
    } catch (failure) { setError(getClientErrorMessage(failure, "Invitation is unavailable.")); }
    finally { setBusy(false); }
  }
  return <Card className="grid gap-4">
    {/* The invitation link is held in this page's memory, so sign-in and verification open in a new tab. */}
    <p className="text-ink-soft">Sign in with the invited email address and verify it before accepting. Both links open in a new tab so this page keeps your invitation.</p>
    <div className="flex flex-wrap gap-4">
      <a className="text-sm font-semibold text-brand underline underline-offset-4" href="/login?callbackUrl=/staff/invites/accept" target="_blank" rel="noopener noreferrer">Sign in (new tab)</a>
      <a className="text-sm font-semibold text-brand underline underline-offset-4" href="/verify-email" target="_blank" rel="noopener noreferrer">Verify your email (new tab)</a>
    </div>
    {error && <Notice role="alert" tone="danger">{error}</Notice>}
    {status ? <Notice action={<Link className="text-sm font-semibold text-brand underline underline-offset-4" href="/dashboard">Open dashboard</Link>} role="status" tone="success">{status}</Notice> : <>
      {!token && <Notice>Open the link from your invitation email to accept it.</Notice>}
      <div><Button disabled={!token || busy} size="lg" type="button" onClick={accept}>
        {busy ? "Accepting..." : "Accept staff invitation"}
      </Button></div>
    </>}
  </Card>;
}
