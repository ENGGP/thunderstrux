"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";
export function ChangeEmailForm({ mfaRequired, pending }: { mfaRequired: boolean; pending: { email: string; expiresAt: string } | null }) {
  const router = useRouter(); const [password, setPassword] = useState(""); const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    const cancel = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "cancel";
    if (!cancel && !newEmail.trim()) { setError("Enter a new email address."); return; }
    setBusy(true);
    try {
      await fetchJson(`/api/me/account/email/${cancel ? "cancel" : "request"}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: password, ...(!cancel ? { newEmail } : {}) }) });
      setPassword(""); setNewEmail(""); setMessage(cancel ? "Email change cancelled." : "If the new address is eligible, a confirmation email has been sent. Your current email remains active until confirmation."); router.refresh();
    } catch (failure) { setError(getClientErrorMessage(failure, "Could not update email change.")); }
    finally { setBusy(false); }
  }
  return <form className="grid gap-3" onSubmit={submit}>
    {error && <p role="alert" className="text-red-700">{error}</p>}{message && <p role="status">{message}</p>}
    {pending && <p>Pending address: {pending.email}. Link expires <time dateTime={pending.expiresAt}>{pending.expiresAt}</time>.</p>}
    {mfaRequired && <p>Verify your enrolled authenticator first. <Link className="underline" href="/mfa?callbackUrl=/account/settings">Verify authenticator</Link></p>}
    <TextInput label="Current password for email change" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} />
    <TextInput label="New email" type="email" maxLength={320} autoComplete="email" value={newEmail} onChange={event => setNewEmail(event.target.value)} />
    <Button type="submit" name="action" value="request" disabled={busy || mfaRequired}>Request email change</Button>
    {pending && <Button type="submit" name="action" value="cancel" disabled={busy || mfaRequired}>Cancel email change</Button>}
  </form>;
}
