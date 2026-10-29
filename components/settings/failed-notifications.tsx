"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextArea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

const templateLabels: Record<string, string> = {
  staff_invite: "Staff invitation",
  business_notice: "Society notice",
  society_enquiry: "Enquiry to the society"
};
const label = (template: string) => templateLabels[template] ?? template.replaceAll("_", " ");

type Job = { id: string; template: string; attempts: number; lastError: string | null };
type Result = { ok: boolean; text: string; skipped?: Array<{ name: string; message: string }> };

// Failed society emails, sent again in one go with one review reason (UI-018).
// Each email still gets its own check and audit row; any that can't be sent are named.
export function FailedNotifications({ jobs }: { jobs: Job[] }) {
  const [remaining, setRemaining] = useState(jobs);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const allSelected = remaining.length > 0 && remaining.every((job) => selected.has(job.id));
  const count = selected.size;

  function toggle(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    setBusy(true);
    try {
      const response = await fetchJson<{ queued: string[]; skipped: Array<{ id: string; message: string }> }>("/api/notifications/requeue", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobIds: [...selected], reason })
      });
      const queued = new Set(response.queued);
      setRemaining((items) => items.filter((item) => !queued.has(item.id)));
      setSelected(new Set(response.skipped.map((entry) => entry.id)));
      if (queued.size) setReason("");
      const names = new Map(remaining.map((job) => [job.id, label(job.template)]));
      setResult({
        ok: response.skipped.length === 0,
        text: queued.size
          ? `${queued.size === 1 ? "1 email" : `${queued.size} emails`} queued to send again.${response.skipped.length ? " These couldn't be sent:" : ""}`
          : "None of these could be sent again:",
        skipped: response.skipped.map((entry) => ({ name: names.get(entry.id) ?? "Email", message: entry.message }))
      });
    } catch (failure) {
      // Each email is queued on its own, so some may have gone through before the error.
      setResult({ ok: false, text: getClientErrorMessage(failure, "That didn't finish. Refresh the page to see which emails are still failed.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">Failed emails</h2>
      {remaining.length === 0 ? <p className="mt-3 text-ink-soft">No failed emails.</p> : null}
      {remaining.length ? (
        <form className="mt-2 grid gap-4" onSubmit={submit}>
          <label className="flex min-h-11 items-center gap-3 border-b border-line text-sm font-semibold text-ink">
            <input
              checked={allSelected}
              className="size-5 accent-brand"
              onChange={(event) => setSelected(event.target.checked ? new Set(remaining.map((job) => job.id)) : new Set())}
              type="checkbox"
            />
            Select all on this page
          </label>
          <ul aria-label="Failed emails" className="grid">
            {remaining.map((job) => (
              <li className="border-t border-line py-3 first:border-0" key={job.id}>
                <label className="flex items-start gap-3">
                  <input checked={selected.has(job.id)} className="mt-1 size-5 shrink-0 accent-brand" onChange={(event) => toggle(job.id, event.target.checked)} type="checkbox" />
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span className="font-semibold text-ink">{label(job.template)}</span>
                      <span className="text-sm text-ink-soft">{job.attempts} {job.attempts === 1 ? "attempt" : "attempts"}</span>
                    </span>
                    {job.lastError ? <span className="text-sm text-danger [overflow-wrap:anywhere]">{job.lastError}</span> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <TextArea
            className="min-h-20"
            hint="8 to 500 characters. Recorded with each retry."
            label="Review reason"
            maxLength={500}
            minLength={8}
            onChange={(event) => setReason(event.target.value)}
            required
            value={reason}
          />
          <div>
            <Button busy={busy} busyLabel="Sending…" disabled={count === 0} type="submit" variant="secondary">
              {count === 0 ? "Send again" : `Send ${count === 1 ? "1 email" : `${count} emails`} again`}
            </Button>
          </div>
          {result ? (
            <Notice reveal role={result.ok ? "status" : "alert"} tone={result.ok ? "success" : "warning"}>
              <p>{result.text}</p>
              {result.skipped?.length ? (
                <ul className="mt-1 list-disc pl-5">
                  {result.skipped.map((entry, index) => <li key={index}>{entry.name}: {entry.message}</li>)}
                </ul>
              ) : null}
            </Notice>
          ) : null}
        </form>
      ) : result ? (
        <Notice className="mt-3" reveal role={result.ok ? "status" : "alert"} tone={result.ok ? "success" : "warning"}>{result.text}</Notice>
      ) : null}
    </Card>
  );
}
