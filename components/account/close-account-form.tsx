"use client";
import { useState, type FormEvent } from "react";
import { signOutTo } from "@/lib/client/sign-out";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

const phrase = "CLOSE MY ACCOUNT";
// Where each of the server's blockers can be resolved.
const blockerLinks: Array<[string, string, string]> = [
  ["Hand over", "/dashboard", "Open your society"],
  ["Resolve pending", "/purchases", "Go to Purchases"],
  ["Resolve outstanding", "/purchases", "Go to Purchases"],
  ["Wait until", "/purchases", "Go to Purchases"]
];

export function CloseAccountForm({ eligibility, mfaRequired }: { eligibility: { eligible: boolean; blockers: string[] }; mfaRequired: boolean }) {
  const [password, setPassword] = useState(""); const [acknowledgement, setAcknowledgement] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const blocked = !eligibility.eligible || mfaRequired;
  // Phones capitalise only the first letter; the words are what count, so case is fixed here. The server still checks them exactly.
  const typed = acknowledgement.trim().toUpperCase();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      await fetchJson("/api/me/account/closure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: password, acknowledgement: typed }) });
      setPassword(""); await signOutTo("/login?accountClosed=true");
    } catch (failure) { setError(getClientErrorMessage(failure, "Could not close your account.")); }
    finally { setBusy(false); }
  }
  return <form className="grid gap-3" onSubmit={submit}>
    <p className="text-sm text-ink-soft">Closing is permanent. Your name, profile and login are removed and every device is signed out. We keep your purchases, tickets and attendance, the contact details those records need, and the records of what happened on your account. Signing up again later won&apos;t give you access to them.</p>
    {!eligibility.eligible && <Notice title="Before you can close this account" tone="warning"><ul className="mt-1 grid gap-1">{eligibility.blockers.map(blocker => {
      const link = blockerLinks.find(([start]) => blocker.startsWith(start));
      return <li key={blocker}><span>{blocker}</span>{link ? <> <Link className="font-semibold text-brand underline underline-offset-4" href={link[1]}>{link[2]}</Link></> : null}</li>;
    })}</ul></Notice>}
    {mfaRequired && <Notice action={<Link className="text-sm font-semibold text-brand underline underline-offset-4" href="/mfa?callbackUrl=/account/settings">Verify authenticator</Link>}>Verify your enrolled authenticator first.</Notice>}
    <div className="grid gap-4 sm:grid-cols-2"><TextInput label="Current password for account closure" type="password" autoComplete="current-password" disabled={blocked} required value={password} onChange={event => setPassword(event.target.value)} />
    <TextInput label={`Type ${phrase} to confirm`} autoCapitalize="characters" autoComplete="off" disabled={blocked} required value={acknowledgement} onChange={event => setAcknowledgement(event.target.value)} /></div>
    <div><Button busy={busy} busyLabel="Closing…" type="submit" variant="danger" disabled={blocked || typed !== phrase}>Permanently close account</Button></div>
    {error && <Notice reveal role="alert" tone="danger">{error}</Notice>}
  </form>;
}
