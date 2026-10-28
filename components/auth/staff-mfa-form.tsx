"use client";

import { useState, type FormEvent } from "react";
import { renderSVG } from "uqr";
import { signOutTo } from "@/lib/client/sign-out";
import { RecoveryCodes } from "@/components/auth/recovery-codes";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

type Setup = { secret: string; otpauthUrl: string };

// The set-up link as a QR code, drawn here from the link the API sends: an SVG
// in an <img> (the CSP allows data: images), dark on white so it scans in dark mode too.
const qrSource = (otpauthUrl: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSVG(otpauthUrl, { border: 2, whiteColor: "#ffffff", blackColor: "#000000" }))}`;

export function StaffMfaForm({ enabled, destination, email, requiresNewLogin = false }: { enabled: boolean; destination: string; email?: string | null; requiresNewLogin?: boolean }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (requiresNewLogin) return (
    <div className="grid gap-4">
      <p className="text-ink-soft">Sign in again to start staff verification for this session.</p>
      <div>
        <Button onClick={() => signOutTo(`/login?callbackUrl=${encodeURIComponent(destination)}`)} type="button">
          Sign out and sign in again
        </Button>
      </div>
    </div>
  );

  async function begin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      setSetup(await fetchJson<Setup>("/api/me/mfa/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) }));
      setPassword("");
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

  const error = message ? <Notice role="alert" tone="danger">{message}</Notice> : null;

  // The recovery view lists only the ten codes: browser tests count them.
  if (recoveryCodes) return (
    <section className="grid gap-4">
      <p className="text-sm font-semibold text-ink-soft">Step 2 of 2</p>
      <h2 className="text-2xl font-semibold text-ink">Save these recovery codes</h2>
      <Notice title="Shown only once" tone="warning">
        Each code works one time if you lose your phone. Store them somewhere safe, such as a password manager. You can replace them later in Account settings.
      </Notice>
      <RecoveryCodes codes={recoveryCodes} email={email} />
      <div>
        <Button onClick={() => window.location.assign(destination)} type="button">
          I saved my codes
        </Button>
      </div>
    </section>
  );

  return (
    <div className="grid gap-5">
      {!enabled && !setup ? (
        <>
          <p className="text-ink-soft">
            Society staff confirm their sign-in with an authenticator app such as Google Authenticator, 1Password or Authy.
          </p>
          <form className="grid gap-3" onSubmit={begin}>
            <TextInput autoComplete="current-password" hint="Setting up an authenticator changes how you sign in, so we check it's you." label="Your password" maxLength={200} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
            <div>
              <Button busy={busy} busyLabel="Checking…" type="submit">
                Set up authenticator
              </Button>
            </div>
          </form>
        </>
      ) : null}
      {setup ? (
        <section className="grid gap-3">
          <p className="text-sm font-semibold text-ink-soft">Step 1 of 2</p>
          <ol className="grid list-decimal gap-3 pl-5 text-ink-soft">
            <li>
              Open your authenticator app, add an account and scan this code.
              <img
                alt="QR code to add Thunderstrux to your authenticator app"
                className="mt-2 block size-48 rounded-control border border-line bg-white"
                height={192}
                src={qrSource(setup.otpauthUrl)}
                width={192}
              />
            </li>
            <li>
              Setting up on this device? You can{" "}
              <a className="font-semibold text-brand underline underline-offset-4" href={setup.otpauthUrl}>
                open it in your authenticator app
              </a>{" "}
              or enter this key by hand:
              <code className="mt-2 block select-all break-all rounded-control bg-surface-subtle px-3 py-2 font-mono text-ink">{setup.secret}</code>
            </li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
        </section>
      ) : null}
      {enabled || setup ? (
        <form className="grid gap-4" onSubmit={submit}>
          <TextInput
            autoComplete="one-time-code"
            className="font-mono"
            label={setup ? "Authenticator code" : "Authenticator or recovery code"}
            onChange={(event) => setCode(event.target.value.trim())}
            required
            value={code}
          />
          <div>
            <Button busy={busy} busyLabel="Checking…" size="lg" type="submit">
              {setup ? "Confirm setup" : "Verify and continue"}
            </Button>
          </div>
        </form>
      ) : null}
      {error}
    </div>
  );
}
