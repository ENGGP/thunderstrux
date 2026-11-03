"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Icon } from "@/components/ui/icon";
import { TextArea, TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { ClientApiError, fetchJson } from "@/lib/client/api";
import { lookupRecoveryCandidate } from "@/app/(admin)/admin/recovery/actions";

// T55 (board H8): a takeover-class request in three steps: who, what you
// checked, then who is told and when it can be completed, with a reason and a
// code. Sending it opens the request's own page.

type Recipient = { email: string; relation: string };
type Candidate = { id: string; name: string; email: string; lastSignInAt: string | null; problem: string | null };

const checks = {
  mfa_reset: ["They wrote from the account's own email address", "They answered from a phone or session we've seen before", "Another staff member of their society confirmed it", "They showed ID on a call"],
  ownership: ["The request came from the new owner's own account address", "The university's club register lists them as a committee member", "Another staff member of the society confirmed it", "They showed ID on a call"]
};

export function RecoveryWizard(props: {
  env: string; kind: "mfa_reset" | "ownership"; label: string; title: string; disabledReason?: string;
  // An authenticator reset is the record you're on; an ownership recovery finds its person in step 1.
  target?: { id: string; name: string }; recipients?: Recipient[]; organisationId?: string; ownersNote?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(props.kind === "mfa_reset" ? 2 : 1);
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<{ candidate: Candidate; recipients: Recipient[] } | null | undefined>(undefined);
  const [ticked, setTicked] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const target = props.target ?? (found && !found.candidate.problem ? { id: found.candidate.id, name: found.candidate.name } : null);
  const recipients = props.recipients ?? found?.recipients ?? [];
  const evidence = [...ticked, notes.trim()].filter(Boolean).join(". ");
  const ready = new Date(Date.now() + 72 * 3_600_000);

  const close = () => { setOpen(false); setError(""); };
  async function find(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setFound(await lookupRecoveryCandidate(props.organisationId ?? "", email));
    } catch {
      setError("The search didn't finish. Try again.");
    }
    setBusy(false);
  }
  async function next() {
    setError("");
    if (step === 1) return target ? setStep(2) : setError("Find an account that can be made an owner first.");
    if (step === 2) return evidence.length >= 8 ? setStep(3) : setError("Tick what you checked, or add notes.");
    if (reason.trim().length < 8) return setError("Give a reason of at least 8 characters.");
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code from your authenticator app.");
    setBusy(true);
    try {
      const result = await fetchJson<{ requestId: string }>("/api/admin/actions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(props.kind === "mfa_reset"
          ? { action: "request_mfa_reset", targetId: target!.id, evidence, reason, code }
          : { action: "request_ownership", targetId: props.organisationId, userId: target!.id, evidence, reason, code })
      });
      router.push(`/admin/recovery/${result.requestId}`);
    } catch (failure) {
      setError(failure instanceof ClientApiError && failure.status < 500 ? failure.message : "We couldn't confirm the request was made. Check the record's Activity before trying again.");
      setCode("");
      setBusy(false);
    }
  }
  const first = props.kind === "mfa_reset" ? 2 : 1;
  const stepName = (n: number) => (n === 1 ? target?.name ?? "Who" : n === 2 ? "Evidence" : "Review");

  if (props.disabledReason) {
    return (
      <span className="flex flex-col items-end gap-0.5">
        <Button disabled size="sm" type="button" variant="secondary">{props.label}</Button>
        <span className="text-[12.5px] text-ink-muted">{props.disabledReason}</span>
      </span>
    );
  }
  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" type="button" variant="secondary">{props.label}</Button>
      <ConfirmDialog busy={busy} cancelLabel={step === first ? "Cancel" : "Back"} confirmLabel={step === 3 ? "Send the request" : "Next"} error={error || undefined}
        onCancel={() => (step === first ? close() : setStep(step - 1))} onConfirm={() => void next()} open={open} title={`${props.env} · ${props.title}`}>
        <div className="grid gap-4 text-ink">
          <ol aria-label="Steps" className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] font-semibold text-ink-muted">
            {[1, 2, 3].filter((n) => n >= first).map((n) => <li aria-current={n === step ? "step" : undefined} className={n === step ? "text-ink" : ""} key={n}>{n - first + 1} · {stepName(n)}{n < step ? " ✓" : ""}</li>)}
          </ol>
          {step === 1 ? (
            <form className="grid gap-3" onSubmit={find}>
              <TextInput autoComplete="off" autoFocus hint="An existing account only: support never invents an identity." label="New owner's email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
              <div><Button busy={busy} busyLabel="Looking" size="sm" type="submit" variant="secondary"><Icon name="search" size={16} />Find account</Button></div>
              {found === null ? <Notice tone="warning">No account uses that email. They sign up first, then you search again.</Notice> : null}
              {found ? (
                <Notice title={found.candidate.name} tone={found.candidate.problem ? "danger" : "success"}>
                  {found.candidate.email}. {found.candidate.problem ?? `Verified and enabled. Last sign-in ${found.candidate.lastSignInAt ? new Date(found.candidate.lastSignInAt).toLocaleDateString("en-AU") : "never"}.`}
                </Notice>
              ) : null}
            </form>
          ) : null}
          {step === 2 ? (
            <>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-semibold">How did you confirm {target?.name ?? "this"} {props.kind === "mfa_reset" ? "is the account holder" : "should own it"}?</legend>
                {checks[props.kind].map((item) => (
                  <label className="flex items-start gap-2 text-sm" key={item}>
                    <input checked={ticked.includes(item)} className="mt-1" onChange={(event) => setTicked(event.target.checked ? [...ticked, item] : ticked.filter((entry) => entry !== item))} type="checkbox" />{item}
                  </label>
                ))}
              </fieldset>
              <TextArea label="Notes" maxLength={700} onChange={(event) => setNotes(event.target.value)} rows={3} value={notes} />
              {props.ownersNote ? <Notice>{props.ownersNote}</Notice> : null}
            </>
          ) : null}
          {step === 3 ? (
            <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void next(); }}>
              <section className="grid gap-1.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-ink-muted">Emailed now</h3>
                <ul className="grid gap-1 text-[13.5px]">
                  {recipients.map((row) => <li className="flex flex-wrap justify-between gap-x-3" key={row.email}><span>{row.email}</span><span className="text-ink-muted">{row.relation}</span></li>)}
                </ul>
              </section>
              <section className="grid gap-1.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-ink-muted">Then</h3>
                <ul className="grid gap-1.5 text-sm">
                  <li className="flex gap-2"><Icon className="mt-0.5 shrink-0 text-ink-soft" name="clock" size={16} /><span>You can complete it from <strong>{ready.toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Brisbane" })}</strong>, Brisbane time, 72 hours from now. Anyone who objects writes to support and you cancel.</span></li>
                  <li className="flex gap-2"><Icon className="mt-0.5 shrink-0 text-ink-soft" name="success" size={16} /><span>{props.kind === "mfa_reset" ? `Completing removes ${target?.name}'s authenticator and recovery codes and signs them out; they set up a new one.` : `Completing makes ${target?.name} an owner. Nobody else's role changes.`}</span></li>
                  {props.kind === "ownership" ? <li className="flex gap-2"><Icon className="mt-0.5 shrink-0 text-ink-soft" name="lock" size={16} /><span>Payouts are held for 7 days after it completes.</span></li> : null}
                </ul>
              </section>
              <TextInput hint="Goes in the audit trail, not in anyone's email." label="Reason" maxLength={400} onChange={(event) => setReason(event.target.value)} value={reason} />
              <TextInput autoComplete="one-time-code" autoFocus hint="It also renews your 60 minutes." inputMode="numeric" label="Authenticator code" maxLength={6} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} value={code} />
              <button className="hidden" type="submit" />
            </form>
          ) : null}
        </div>
      </ConfirmDialog>
    </>
  );
}
