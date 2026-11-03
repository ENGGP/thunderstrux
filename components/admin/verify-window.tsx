"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

// T54 (boards H1, H10): reading needs an authenticator verification in the last
// 60 minutes. The chip counts down; when it reaches zero, a code dialog covers
// the page so you keep your place, and a verified code reloads it.
export function VerifyWindow({ endsAt }: { endsAt: string }) {
  const [now, setNow] = useState<number | null>(null);
  const pathname = usePathname() ?? "/admin";
  const search = useSearchParams()?.toString() ?? "";
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const left = now === null ? null : Math.ceil((new Date(endsAt).getTime() - now) / 60_000);
  const here = encodeURIComponent(pathname + (search ? `?${search}` : ""));

  if (left !== null && left <= 0) {
    return (
      <>
        <span className="inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-full border border-danger-border bg-danger-bg px-2.5 text-[13px] font-semibold text-danger">
          <Icon name="lock" size={16} />Code needed
        </span>
        <VerifyDialog />
      </>
    );
  }
  const low = left !== null && left <= 10;
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[13px] font-semibold ${low
        ? "border-warning-border bg-warning-bg text-warning" : "border-neutral-border bg-neutral-bg text-neutral"}`}>
        <Icon name={low ? "clock" : "lock"} size={16} />
        {left === null ? "Verified" : low ? `${left} min left` : `Verified · ${left} min left`}
      </span>
      {low ? <a className="min-h-8 rounded-control border border-line-strong bg-surface px-2.5 py-1 text-[13px] font-semibold" href={`/mfa?callbackUrl=${here}`}>Extend</a> : null}
    </span>
  );
}

function VerifyDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await fetchJson("/api/me/mfa/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      window.location.reload();
    } catch (error) {
      setMessage(getClientErrorMessage(error, "That code didn't work."));
      setBusy(false);
    }
  }

  return (
    <dialog
      aria-labelledby="admin-verify-title"
      className="m-auto w-[min(420px,calc(100vw-32px))] rounded-[12px] border border-line bg-surface p-0 text-ink shadow-[var(--shadow-float)] backdrop:bg-[rgba(36,20,59,0.18)] backdrop:backdrop-blur-sm"
      onCancel={(event) => event.preventDefault()}
      ref={dialog}
    >
      <form className="grid gap-4 p-5" onSubmit={submit}>
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold" id="admin-verify-title">Your 60 minutes are up</h2>
          <p className="text-sm text-ink-soft">Enter a code to keep reading. This page stays where it is.</p>
        </div>
        <TextInput autoComplete="one-time-code" autoFocus inputMode="text" label="Authenticator or recovery code" maxLength={32} onChange={(event) => setCode(event.target.value.trim())} required value={code} />
        {message ? <Notice role="alert" tone="danger">{message}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Button busy={busy} busyLabel="Checking" type="submit">Verify</Button>
        </div>
      </form>
    </dialog>
  );
}
