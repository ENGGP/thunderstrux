"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";
import { formatDateTime } from "@/lib/format";
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
    {error && <Notice role="alert" tone="danger">{error}</Notice>}{message && <Notice role="status" tone="success">{message}</Notice>}
    {pending && <Notice>Pending address: {pending.email}. Link expires <time dateTime={pending.expiresAt}>{formatDateTime(pending.expiresAt)}</time>. Your current address stays active until then; request the change again to send a new link.</Notice>}
    {mfaRequired && <Notice action={<Link className="text-sm font-semibold text-brand underline underline-offset-4" href="/mfa?callbackUrl=/account/settings">Verify authenticator</Link>}>Verify your enrolled authenticator first.</Notice>}
    <div className="grid gap-4 sm:grid-cols-2"><TextInput label="Current password for email change" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} />
    <TextInput label="New email" type="email" maxLength={320} autoComplete="email" value={newEmail} onChange={event => setNewEmail(event.target.value)} /></div>
    <div className="flex flex-wrap gap-3"><Button type="submit" name="action" value="request" variant="secondary" disabled={busy || mfaRequired}>Request email change</Button>
    {pending && <Button type="submit" name="action" value="cancel" variant="tertiary" disabled={busy || mfaRequired}>Cancel email change</Button>}</div>
  </form>;
}
