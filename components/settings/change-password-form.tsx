"use client";
import { useState, type FormEvent } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
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
      await signOut({ callbackUrl: "/login?passwordChanged=true" });
    } catch (failure) { setError(getClientErrorMessage(failure, "Could not change password.")); setBusy(false); }
  }
  return <form className="grid gap-3" onSubmit={submit}>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {mfaRequired && <p>Verify your enrolled authenticator first. <Link className="underline" href="/mfa?callbackUrl=/account/settings">Verify authenticator</Link></p>}
    <TextInput label="Current password" type="password" autoComplete="current-password" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} />
    <TextInput label="New password" type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={event => setNewPassword(event.target.value)} />
    <TextInput label="Confirm new password" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={event => setConfirmation(event.target.value)} />
    <p className="text-sm text-neutral-600">Use at least 8 characters and no more than 72 UTF-8 bytes. Changing your password signs out all devices; your authenticator remains enrolled.</p>
    <Button type="submit" disabled={busy || mfaRequired}>{busy ? "Changing password..." : "Change password"}</Button>
  </form>;
}
