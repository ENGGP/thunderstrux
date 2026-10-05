"use client";
import { useState, type FormEvent } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";
export function CloseAccountForm({ eligibility, mfaRequired }: { eligibility: { eligible: boolean; blockers: string[] }; mfaRequired: boolean }) {
  const [password, setPassword] = useState(""); const [acknowledgement, setAcknowledgement] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      await fetchJson("/api/me/account/closure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: password, acknowledgement }) });
      setPassword(""); await signOut({ callbackUrl: "/login?accountClosed=true" });
    } catch (failure) { setError(getClientErrorMessage(failure, "Could not close your account.")); }
    finally { setBusy(false); }
  }
  return <form className="grid gap-3" onSubmit={submit}>
    <p>Closure is permanent. Your editable profile and login credentials are anonymised and every device is signed out. Purchases, tickets, attendance, buyer contact details needed for those records, and audit/security records remain. A new signup cannot access your old records.</p>
    {!eligibility.eligible && <ul className="list-inside list-disc">{eligibility.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>}
    {mfaRequired && <p>Verify your enrolled authenticator first. <Link className="underline" href="/mfa?callbackUrl=/account/settings">Verify authenticator</Link></p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <TextInput label="Current password for account closure" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} />
    <TextInput label="Type CLOSE MY ACCOUNT to confirm" autoComplete="off" required value={acknowledgement} onChange={event => setAcknowledgement(event.target.value)} />
    <Button type="submit" disabled={busy || !eligibility.eligible || mfaRequired || acknowledgement !== "CLOSE MY ACCOUNT"}>{busy ? "Closing..." : "Permanently close account"}</Button>
  </form>;
}
