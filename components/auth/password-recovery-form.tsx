"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";
export function PasswordRecoveryForm({ mode, callbackUrl }: { mode: "request" | "reset"; callbackUrl: string }) {
  const [email, setEmail] = useState(""); const [token, setToken] = useState("");
  const [password, setPassword] = useState(""); const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [completedPath, setCompletedPath] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== "reset") return;
    setToken(new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, [mode]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    if (mode === "reset" && password !== confirmation) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      if (mode === "request") {
        await fetchJson("/api/auth/password/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, callbackUrl }) });
        setMessage("If this address is eligible, a password reset email has been sent. Check your inbox.");
      } else {
        const result = await fetchJson<{ reset: boolean; callbackUrl: string }>("/api/auth/password/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, newPassword: password }) });
        setToken(""); setPassword(""); setConfirmation(""); setCompletedPath(result.callbackUrl);
        setMessage("Password reset. All devices are signed out. Sign in with your new password.");
      }
    } catch (failure) { setError(getClientErrorMessage(failure, "Could not complete password recovery.")); }
    finally { setBusy(false); }
  }
  return <div className="grid gap-4">
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {message && <p role="status">{message}</p>}
    {completedPath ? <Link className="underline" href={`/login?callbackUrl=${encodeURIComponent(completedPath)}`}>Sign in with new password</Link> : <form className="grid gap-3" onSubmit={submit}>
      {mode === "request" ? <TextInput label="Email" type="email" required maxLength={320} value={email} onChange={event => setEmail(event.target.value)} /> : <>
        {!token && <p>Open your reset email link, or <Link className="underline" href="/forgot-password">request a new link</Link>.</p>}
        <TextInput label="New password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} />
        <TextInput label="Confirm new password" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={event => setConfirmation(event.target.value)} />
        <p className="text-sm text-neutral-600">Use at least 8 characters and no more than 72 UTF-8 bytes. Your enrolled authenticator remains enabled.</p>
      </>}
      <Button type="submit" disabled={busy || (mode === "reset" && !token)}>{busy ? "Submitting..." : mode === "request" ? "Send password reset email" : "Reset password"}</Button>
    </form>}
  </div>;
}
