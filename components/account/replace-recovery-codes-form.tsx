"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RecoveryCodes } from "@/components/auth/recovery-codes";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

// Replace every recovery code (UI-018): the password and a current authenticator
// code, then the new codes once, with Copy all and Download.
export function ReplaceRecoveryCodesForm({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await fetchJson<{ recoveryCodes: string[] }>("/api/me/mfa/recovery-codes", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, code })
      });
      setCodes(result.recoveryCodes);
      setPassword("");
      setCode("");
      setOpen(false);
      // The "N of 10 left" count reads the new state.
      router.refresh();
    } catch (failure) {
      setError(getClientErrorMessage(failure, "Couldn't replace your recovery codes. Nothing changed."));
    } finally {
      setBusy(false);
    }
  }

  if (codes) return (
    <div className="grid gap-3">
      <Notice reveal role="status" title="New recovery codes" tone="success">
        Your old codes no longer work. Save these now: they're shown only once.
      </Notice>
      <RecoveryCodes codes={codes} email={email} />
    </div>
  );

  if (!open) return (
    <div>
      <Button onClick={() => setOpen(true)} type="button" variant="secondary">
        Get new recovery codes
      </Button>
    </div>
  );

  return (
    <form className="grid gap-3" onSubmit={submit}>
      <TextInput autoComplete="current-password" label="Your password" maxLength={200} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
      <TextInput
        autoComplete="one-time-code"
        className="font-mono"
        hint="The 6-digit code from your authenticator app. Your old recovery codes stop working."
        inputMode="numeric"
        label="Authenticator code"
        maxLength={6}
        onChange={(event) => setCode(event.target.value.trim())}
        required
        value={code}
      />
      <div className="flex flex-wrap gap-2">
        <Button busy={busy} busyLabel="Replacing…" type="submit" variant="secondary">
          Replace recovery codes
        </Button>
        <Button disabled={busy} onClick={() => { setOpen(false); setError(""); }} type="button" variant="tertiary">
          Cancel
        </Button>
      </div>
      {error ? <Notice reveal role="alert" tone="danger">{error}</Notice> : null}
    </form>
  );
}
