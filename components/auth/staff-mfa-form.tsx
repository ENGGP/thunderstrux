"use client";

import { useState, type FormEvent } from "react";
import { signOut } from "next-auth/react";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

type Setup = { secret: string; otpauthUrl: string };

export function StaffMfaForm({ enabled, destination, requiresNewLogin = false }: { enabled: boolean; destination: string; requiresNewLogin?: boolean }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (requiresNewLogin) return (
    <div className="mt-6 space-y-4">
      <p className="text-sm text-ink-soft">Sign in again to start staff verification for this session.</p>
      <button className="rounded-control bg-brand px-4 py-2 text-white" onClick={() => signOut({ callbackUrl: `/login?callbackUrl=${encodeURIComponent(destination)}` })}>
        Sign out and sign in again
      </button>
    </div>
  );

  async function begin() {
    setBusy(true);
    setMessage("");
    try {
      setSetup(await fetchJson<Setup>("/api/me/mfa/setup", { method: "POST" }));
    } catch (error) {
      setMessage(getClientErrorMessage(error, "Could not begin MFA setup."));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (setup) {
        const result = await fetchJson<{ recoveryCodes: string[] }>("/api/me/mfa/confirm", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code })
        });
        setRecoveryCodes(result.recoveryCodes);
      } else {
        await fetchJson("/api/me/mfa/verify", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code })
        });
        window.location.assign(destination);
      }
      setCode("");
    } catch (error) {
      setMessage(getClientErrorMessage(error, "Verification failed."));
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCodes) return (
    <section className="mt-6 space-y-4">
      <h2 className="font-semibold text-ink">Save these recovery codes</h2>
      <p className="text-sm text-ink-muted">Each code works once. Store them somewhere private; they will not be shown again.</p>
      <ul className="grid grid-cols-2 gap-2 rounded-card bg-surface-subtle p-4 font-mono text-sm">
        {recoveryCodes.map((entry) => <li key={entry}>{entry}</li>)}
      </ul>
      <button className="rounded-control bg-brand px-4 py-2 text-white" onClick={() => window.location.assign(destination)}>
        I saved my codes
      </button>
    </section>
  );

  return (
    <div className="mt-6 space-y-5">
      {!enabled && !setup ? (
        <button className="rounded-control bg-brand px-4 py-2 text-white disabled:opacity-50" disabled={busy} onClick={begin}>
          Set up authenticator
        </button>
      ) : null}
      {setup ? (
        <section className="space-y-2 text-sm text-ink-soft">
          <p>Enter this key in your authenticator app:</p>
          <code className="block break-all rounded-card bg-surface-subtle p-3 select-all">{setup.secret}</code>
          <a className="text-brand underline" href={setup.otpauthUrl}>Open in authenticator app</a>
        </section>
      ) : null}
      {enabled || setup ? (
        <form className="space-y-3" onSubmit={submit}>
          <label className="block text-sm font-medium text-ink-soft" htmlFor="mfa-code">
            {setup ? "Authenticator code" : "Authenticator or recovery code"}
          </label>
          <input id="mfa-code" className="w-full rounded-control border border-line-strong px-3 py-2 font-mono"
            autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.trim())} required />
          <button className="rounded-control bg-brand px-4 py-2 text-white disabled:opacity-50" disabled={busy} type="submit">
            {setup ? "Confirm setup" : "Verify and continue"}
          </button>
        </form>
      ) : null}
      {message ? <p role="alert" className="text-sm text-danger">{message}</p> : null}
    </div>
  );
}
