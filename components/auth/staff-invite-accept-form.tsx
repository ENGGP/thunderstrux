"use client";
import Link from "next/link";
import { useState } from "react";
import { useAccountLinkToken } from "./account-link-token";
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
  return <div className="grid gap-4">
    <p>Sign in with the invited email and verify it before accepting. You can sign in or verify in another tab, then return here.</p>
    <div className="flex flex-wrap gap-4">
      <a className="underline" href="/login?callbackUrl=/staff/invites/accept" target="_blank" rel="noopener noreferrer">Sign in in another tab</a>
      <a className="underline" href="/account/settings" target="_blank" rel="noopener noreferrer">Verify your email</a>
    </div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {status ? <><p role="status">{status}</p><Link className="underline" href="/dashboard">Open dashboard</Link></> : <>
      {!token && <p>Open the link from your invitation email. After a full reload, reopen that link.</p>}
      <button className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50" disabled={!token || busy} type="button" onClick={accept}>
        {busy ? "Accepting..." : "Accept staff invitation"}
      </button>
    </>}
  </div>;
}
