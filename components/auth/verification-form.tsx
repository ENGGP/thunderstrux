"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useAccountLinkToken } from "./account-link-token";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Button, buttonClasses } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";
export function VerificationForm({ callbackUrl, defaultEmail = "" }: { callbackUrl: string; defaultEmail?: string }) {
  const [token, setToken] = useAccountLinkToken();
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  // Each form has its own busy state, so pressing one never relabels the other.
  const [busy, setBusy] = useState<"verify" | "resend" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [verifiedPath, setVerifiedPath] = useState<string | null>(null);
  useEffect(() => { if (token) { setVerifiedPath(null); setMessage(""); setError(""); } }, [token]);
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("verify"); setError("");
    try {
      const result = await fetchJson<{ verified: boolean; callbackUrl: string; email: string }>("/api/auth/verification/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password })
      });
      setToken("");
      // The password was just proven, so sign in with it and go straight back to
      // where the buyer was (often checkout) instead of asking for it again.
      const signedIn = await signIn("credentials", { email: result.email, password, redirect: false }).catch(() => null);
      setPassword("");
      if (signedIn?.ok && !signedIn.error) {
        setMessage("Email verified. Taking you back…");
        window.location.href = result.callbackUrl;
        return;
      }
      setVerifiedPath(result.callbackUrl); setMessage("Email verified. Sign in to continue.");
    } catch (failure) { setError(getClientErrorMessage(failure, "Could not verify this link.")); }
    finally { setBusy(null); }
  }
  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("resend"); setError(""); setMessage("");
    try {
      await fetchJson("/api/auth/verification/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, callbackUrl }) });
      setMessage("If this address is eligible, a verification email has been sent. Check your inbox.");
    } catch (failure) { setError(getClientErrorMessage(failure, "Could not request verification.")); }
    finally { setBusy(null); }
  }
  // Results sit under the forms, so neither form moves when one arrives.
  const results = <>
    {error && <Notice reveal role="alert" tone="danger">{error}</Notice>}
    {message && <Notice reveal role="status" tone="success">{message}</Notice>}
  </>;
  return <div className="grid gap-4">
    {verifiedPath ? <Link className={buttonClasses({ size: "lg" })} href={`/login?callbackUrl=${encodeURIComponent(verifiedPath)}`}>Sign in to continue</Link> : <>
      {token && <form className="grid gap-3" onSubmit={confirm}>
        <TextInput label="Password" type="password" autoComplete="current-password" required maxLength={200} value={password} onChange={event => setPassword(event.target.value)}
          hint="Enter the password for this account. If you didn't set it, reset the password instead; that also verifies your email." />
        <Button busy={busy === "verify"} busyLabel="Verifying…" disabled={busy !== null} size="lg" type="submit">Verify email</Button>
        <Link className="text-sm font-semibold text-brand underline underline-offset-4" href={`/forgot-password?callbackUrl=${encodeURIComponent(callbackUrl)}`}>Reset password</Link>
      </form>}
      <form className="grid gap-3" onSubmit={resend}>
        <TextInput autoComplete="email" label="Email" type="email" required maxLength={320} value={email} onChange={event => setEmail(event.target.value)} />
        {/* With a link open, verifying is the main action; sending a new link is secondary. */}
        <Button busy={busy === "resend"} busyLabel="Sending…" disabled={busy !== null} type="submit" variant={token ? "secondary" : "primary"}>Send verification email</Button>
      </form>
      <Link className="text-sm font-semibold text-brand underline underline-offset-4" href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}>Sign in</Link>
    </>}
    {results}
  </div>;
}
