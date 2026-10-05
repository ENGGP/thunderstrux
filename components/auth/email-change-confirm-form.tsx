"use client";
import { useEffect, useState, type FormEvent } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";
import { useAccountLinkToken } from "./account-link-token";
export function EmailChangeConfirmForm() {
  const { data: session, status, update } = useSession(); const [token, setToken] = useAccountLinkToken();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [mfaRequired, setMfaRequired] = useState(false);
  useEffect(() => {
    let active = true;
    if (session?.user?.id) fetchJson<{ mfa: { enabled: boolean; verified: boolean } }>("/api/me/account").then(account => { if (active) setMfaRequired(account.mfa.enabled && !account.mfa.verified); }).catch(() => {});
    return () => { active = false; };
  }, [session?.user?.id]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      if (!session?.user?.id) {
        const result = await signIn("credentials", { email, password, redirect: false, callbackUrl: "/change-email" });
        if (!result?.ok || result.error) throw new Error("Invalid email or password.");
        setPassword(""); await update();
      } else {
        await fetchJson("/api/me/account/email/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: password, token }) });
        setPassword(""); setToken(""); await signOut({ callbackUrl: "/login?emailChanged=true" });
      }
    } catch (failure) { setError(getClientErrorMessage(failure, "Could not confirm email change.")); }
    finally { setBusy(false); }
  }
  return <form className="grid gap-3" onSubmit={submit}>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {!token && <p>Open the confirmation link from your new inbox, or <Link className="underline" href="/account/settings">request another email change</Link>.</p>}
    {session?.user?.id ? <p>Signed in as {session.user.email}. Enter your current password to confirm the new address.</p> : <><p>Sign in to your existing account first. Keep this page open while you sign in.</p><TextInput label="Current account email" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></>}
    <TextInput label="Current account password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} />
    {session?.user?.id && <p>If you have an enrolled authenticator, <Link className="underline" href="/mfa?callbackUrl=/account/settings" target="_blank" rel="noopener noreferrer">verify authenticator in another tab</Link>, then return here. Refreshing this page requires reopening the email link.</p>}
    {mfaRequired && <p>Authenticator verification is required before confirmation.</p>}
    <Button type="submit" disabled={busy || status === "loading" || !token}>{busy ? "Submitting..." : session?.user?.id ? "Confirm email change" : "Sign in to confirm"}</Button>
  </form>;
}
