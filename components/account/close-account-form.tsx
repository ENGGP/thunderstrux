"use client";
import { useState, type FormEvent } from "react";
import { signOutTo } from "@/lib/client/sign-out";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";
export function CloseAccountForm({ eligibility, mfaRequired }: { eligibility: { eligible: boolean; blockers: string[] }; mfaRequired: boolean }) {
  const [password, setPassword] = useState(""); const [acknowledgement, setAcknowledgement] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      await fetchJson("/api/me/account/closure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: password, acknowledgement }) });
      setPassword(""); await signOutTo("/login?accountClosed=true");
    } catch (failure) { setError(getClientErrorMessage(failure, "Could not close your account.")); }
    finally { setBusy(false); }
  }
  return <form className="grid gap-3" onSubmit={submit}>
    <p className="text-sm text-ink-soft">Closing is permanent and cannot be reversed. Your editable profile and login credentials are anonymised and every device is signed out. Purchases, tickets, attendance, buyer contact details needed for those records, and audit/security records remain. A new signup cannot access your old records.</p>
    {!eligibility.eligible && <Notice title="Before you can close this account" tone="warning"><ul className="mt-1 list-disc pl-5">{eligibility.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul></Notice>}
    {mfaRequired && <Notice action={<Link className="text-sm font-semibold text-brand underline underline-offset-4" href="/mfa?callbackUrl=/account/settings">Verify authenticator</Link>}>Verify your enrolled authenticator first.</Notice>}
    <div className="grid gap-4 sm:grid-cols-2"><TextInput label="Current password for account closure" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} />
    <TextInput label="Type CLOSE MY ACCOUNT to confirm" autoComplete="off" required value={acknowledgement} onChange={event => setAcknowledgement(event.target.value)} /></div>
    <div><Button busy={busy} busyLabel="Closing…" type="submit" variant="danger" disabled={!eligibility.eligible || mfaRequired || acknowledgement !== "CLOSE MY ACCOUNT"}>Permanently close account</Button></div>
    {error && <Notice reveal role="alert" tone="danger">{error}</Notice>}
  </form>;
}
