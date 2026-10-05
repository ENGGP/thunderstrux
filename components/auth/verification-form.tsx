"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useAccountLinkToken } from "./account-link-token";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";
export function VerificationForm({ callbackUrl }: { callbackUrl: string }) {
  const [token, setToken] = useAccountLinkToken();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [verifiedPath, setVerifiedPath] = useState<string | null>(null);
  useEffect(() => { if (token) { setVerifiedPath(null); setMessage(""); setError(""); } }, [token]);
  async function confirm() {
    setBusy(true); setError("");
    try {
      const result = await fetchJson<{ verified: boolean; callbackUrl: string }>("/api/auth/verification/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token })
      });
      setToken(""); setVerifiedPath(result.callbackUrl); setMessage("Email verified. Sign in to continue.");
    } catch (failure) { setError(getClientErrorMessage(failure, "Could not verify this link.")); }
    finally { setBusy(false); }
  }
  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      await fetchJson("/api/auth/verification/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, callbackUrl }) });
      setMessage("If this address is eligible, a verification email has been sent. Check your inbox.");
    } catch (failure) { setError(getClientErrorMessage(failure, "Could not request verification.")); }
    finally { setBusy(false); }
  }
  return <div className="grid gap-4">
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {message && <p role="status">{message}</p>}
    {verifiedPath ? <Link className="underline" href={`/login?callbackUrl=${encodeURIComponent(verifiedPath)}`}>Sign in to continue</Link> : <>
      {token && <Button disabled={busy} onClick={confirm} type="button">{busy ? "Verifying..." : "Verify email"}</Button>}
      <form className="grid gap-3" onSubmit={resend}>
        <TextInput label="Email" type="email" required maxLength={320} value={email} onChange={event => setEmail(event.target.value)} />
        <Button type="submit" disabled={busy}>{busy ? "Sending..." : "Send verification email"}</Button>
      </form>
      <Link className="underline" href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}>Sign in</Link>
    </>}
  </div>;
}
