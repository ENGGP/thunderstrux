"use client";
import { useState, type FormEvent } from "react";
import { signOutTo } from "@/lib/client/sign-out";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";
export function ChangePasswordForm({ mfaRequired }: { mfaRequired: boolean }) {
  const [currentPassword, setCurrentPassword] = useState(""); const [newPassword, setNewPassword] = useState(""); const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (newPassword !== confirmation) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      await fetchJson("/api/me/account/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
      await signOutTo("/login?passwordChanged=true");
    } catch (failure) { setError(getClientErrorMessage(failure, "Could not change password.")); setBusy(false); }
  }
  return <form className="grid gap-3" onSubmit={submit}>
    {mfaRequired && <Notice action={<Link className="text-sm font-semibold text-brand underline underline-offset-4" href="/mfa?callbackUrl=/account/settings">Verify authenticator</Link>}>Verify your enrolled authenticator first.</Notice>}
    <TextInput label="Current password" type="password" autoComplete="current-password" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} />
    <TextInput label="New password" type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={event => setNewPassword(event.target.value)} />
    <TextInput label="Confirm new password" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={event => setConfirmation(event.target.value)} />
    <p className="text-sm text-ink-muted">At least 8 characters. Changing it signs you out on every device.</p>
    <div><Button busy={busy} busyLabel="Changing password…" type="submit" variant="secondary" disabled={mfaRequired}>Change password</Button></div>
    {error && <Notice reveal role="alert" tone="danger">{error}</Notice>}
  </form>;
}
