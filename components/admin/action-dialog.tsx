"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Icon } from "@/components/ui/icon";
import { Select, TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { ClientApiError, fetchJson } from "@/lib/client/api";
import type { ActionSpec } from "@/lib/platform/specs";

// T55 (board H7): every change in the portal is the same three steps, so it
// becomes muscle memory: what will happen, why, then a fresh code. The result
// sits under the button that started it, with Undo where there is an opposite.
// What each dialog says comes from lib/platform/specs.ts.

type Failure = { kind: "refused"; message: string } | { kind: "broken"; at: string };

export function ActionDialog({ env, spec, onClose, onDone }: { env: string; spec: ActionSpec; onClose: () => void; onDone: (reason: string) => void }) {
  const [choice, setChoice] = useState(spec.defaultReason ? "Other" : spec.reasons[0] ?? "Other");
  const [details, setDetails] = useState(spec.defaultReason ?? "");
  const [until, setUntil] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const formId = useId();
  const reason = choice === "Other" ? details.trim() : [choice, details.trim()].filter(Boolean).join(": ");
  const operation = `admin.${spec.request.action}`;

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    if (reason.length < 8) return setFailure({ kind: "refused", message: "Give a reason of at least 8 characters. Pick one, or add details." });
    if (!/^\d{6}$/.test(code)) return setFailure({ kind: "refused", message: "Enter the 6-digit code from your authenticator app." });
    setBusy(true);
    setFailure(null);
    try {
      await fetchJson("/api/admin/actions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...spec.request, reason, code, ...(spec.untilField ? { heldUntil: until ? new Date(until).toISOString() : null } : {}) })
      });
      onDone(reason);
    } catch (error) {
      // A refusal changed nothing and keeps what you typed, except the used code.
      if (error instanceof ClientApiError && error.status < 500) setFailure({ kind: "refused", message: error.message });
      else setFailure({ kind: "broken", at: new Date().toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", second: "2-digit" }) });
      setCode("");
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog busy={busy} confirmLabel={spec.confirm} destructive={spec.danger} error={failure?.kind === "refused" ? failure.message : undefined}
      onCancel={onClose} onConfirm={() => void submit()} open title={`${env} · ${spec.title}`}>
      <form className="grid gap-4 text-ink" id={formId} onSubmit={submit}>
        {spec.subtitle ? <p className="-mt-2 font-mono text-[12.5px] text-ink-muted">{spec.subtitle}</p> : null}
        <section aria-label="What will happen" className="grid gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink-muted">1 · What will happen</h3>
          <ul className="grid gap-1.5">
            {spec.does.map((line) => <li className="flex gap-2" key={line}><Icon className="mt-0.5 shrink-0 text-ink-soft" name="success" size={16} />{line}</li>)}
            {spec.warn?.map((line) => <li className="flex gap-2 font-semibold text-warning" key={line}><Icon className="mt-0.5 shrink-0" name="warning" size={16} />{line}</li>)}
          </ul>
          {spec.doesNot?.length ? (
            <ul aria-label="What it doesn't do" className="grid gap-1.5 text-ink-soft">
              {spec.doesNot.map((line) => <li className="flex gap-2" key={line}><span aria-hidden="true" className="w-4 shrink-0 text-center">–</span>{line}</li>)}
            </ul>
          ) : null}
        </section>
        <section aria-label="Why" className="grid gap-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink-muted">2 · Why</h3>
          {spec.reasons.length ? (
            <Select label="Reason" onChange={(event) => setChoice(event.target.value)} value={choice}>
              {[...spec.reasons, "Other"].map((option) => <option key={option}>{option}</option>)}
            </Select>
          ) : null}
          <TextInput hint="Goes in the audit trail and the alert, never in anyone's email. Add the ticket or email reference." label={choice === "Other" ? "Reason" : "Details"}
            maxLength={400} onChange={(event) => setDetails(event.target.value)} value={details} />
          {spec.untilField ? <TextInput hint="Leave empty to hold until released." label="Hold until (optional)" onChange={(event) => setUntil(event.target.value)} type="datetime-local" value={until} /> : null}
        </section>
        <section aria-label="Code" className="grid gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink-muted">3 · Code</h3>
          <TextInput autoComplete="one-time-code" hint="It also renews your 60 minutes." inputMode="numeric" label="Authenticator code" maxLength={6}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} autoFocus pattern="\d{6}" value={code} />
        </section>
        {failure?.kind === "broken" ? <BrokenNotice at={failure.at} operation={operation} /> : null}
        {/* Enter in any field submits once the code is filled. */}
        <button className="hidden" type="submit" />
      </form>
    </ConfirmDialog>
  );
}

function BrokenNotice({ operation, at }: { operation: string; at: string }) {
  const details = `api.request_failed operation=${operation} at ${at}`;
  return (
    <Notice action={<Button onClick={() => void navigator.clipboard?.writeText(details).catch(() => undefined)} size="sm" type="button" variant="secondary">Copy details</Button>}
      role="alert" title="We couldn't confirm that went through" tone="danger">
      Check Activity before trying again. In the logs, look for <code className="font-mono">api.request_failed</code> with operation <code className="font-mono">{operation}</code> at {at}.
    </Notice>
  );
}

// One button, or an Actions menu of several. Only actions the operator's role
// allows are passed in; one that doesn't apply now stays, disabled, with why.
export function AdminActions({ env, specs, menuLabel = "Actions" }: { env: string; specs: ActionSpec[]; menuLabel?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<ActionSpec | null>(null);
  const [menu, setMenu] = useState(false);
  const [result, setResult] = useState<{ spec: ActionSpec; reason: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menuRef.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [menu]);

  if (specs.length === 0) return null;
  const start = (spec: ActionSpec) => { setMenu(false); setResult(null); setOpen(spec); };
  return (
    <div className="flex flex-col items-end gap-2">
      {specs.length === 1 && !specs[0].disabledReason ? (
        <Button onClick={() => start(specs[0])} size="sm" type="button" variant={specs[0].danger ? "danger" : "secondary"}>{specs[0].label}</Button>
      ) : specs.length === 1 ? (
        <span className="flex flex-col items-end gap-0.5">
          <Button disabled size="sm" type="button" variant="secondary">{specs[0].label}</Button>
          <span className="text-[12.5px] text-ink-muted">{specs[0].disabledReason}</span>
        </span>
      ) : (
        <div className="relative" ref={menuRef}>
          <Button aria-controls={menuId} aria-expanded={menu} aria-haspopup="true" onClick={() => setMenu(!menu)} size="sm" type="button" variant="secondary">
            {menuLabel}<Icon name="chevronDown" size={16} />
          </Button>
          {menu ? (
            <ul className="absolute right-0 z-20 mt-1 grid w-[min(320px,calc(100vw-32px))] gap-0.5 rounded-[10px] border border-line bg-surface p-1.5 shadow-float" id={menuId}>
              {specs.map((spec) => (
                <li key={spec.key}>
                  <button autoFocus={spec === specs.find((item) => !item.disabledReason)} className={`flex w-full flex-col items-start rounded-[6px] px-3 py-2 text-left text-sm enabled:hover:bg-surface-subtle disabled:cursor-not-allowed ${spec.danger && !spec.disabledReason ? "text-danger" : "text-ink"} disabled:text-ink-muted`}
                    disabled={Boolean(spec.disabledReason)} onClick={() => start(spec)} type="button">
                    <span className="font-semibold">{spec.label}</span>
                    {spec.disabledReason ? <span className="text-[12.5px]">{spec.disabledReason}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      {result ? (
        <Notice action={result.spec.undo ? (
          <Button onClick={() => start({ ...result.spec.undo!, defaultReason: `Undo: ${result.reason}`.slice(0, 400) })} size="sm" type="button" variant="secondary">
            <Icon name="return" size={16} />Undo
          </Button>
        ) : undefined} className="w-full max-w-[560px] text-left" onDismiss={() => setResult(null)} reveal role="status" title={result.spec.done.title} tone="success">
          {result.spec.done.body}
        </Notice>
      ) : null}
      {open ? (
        <ActionDialog env={env} key={open.key + (open.defaultReason ?? "")} onClose={() => setOpen(null)} onDone={(reason) => {
          setResult({ spec: open, reason });
          setOpen(null);
          router.refresh();
        }} spec={open} />
      ) : null}
    </div>
  );
}
