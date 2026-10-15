"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextArea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

const templateLabels: Record<string, string> = {
  staff_invite: "Staff invitation",
  business_notice: "Society notice"
};

export function FailedNotifications({ jobs }: { jobs: Array<{ id: string; template: string; attempts: number; lastError: string | null }> }) {
  const [remaining, setRemaining] = useState(jobs);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">Failed emails</h2>
      {result ? (
        <Notice className="mt-4" role={result.ok ? "status" : "alert"} tone={result.ok ? "success" : "danger"}>
          {result.text}
        </Notice>
      ) : null}
      {remaining.length === 0 ? <p className="mt-3 text-ink-soft">No failed emails.</p> : null}
      <ul className="mt-2 grid">
        {remaining.map((job) => (
          <li className="border-t border-line py-4 first:border-0" key={job.id}>
            <form
              className="grid gap-3"
              onSubmit={async (event) => {
                event.preventDefault();
                setResult(null);
                setBusy(job.id);
                const reason = new FormData(event.currentTarget).get("reason");
                try {
                  await fetchJson(`/api/notifications/${job.id}/requeue`, { method: "POST", body: JSON.stringify({ reason }), headers: { "Content-Type": "application/json" } });
                  setRemaining((items) => items.filter((item) => item.id !== job.id));
                  setResult({ ok: true, text: "Email queued to send again." });
                } catch (failure) {
                  setResult({ ok: false, text: getClientErrorMessage(failure, "Could not requeue notification") });
                } finally {
                  setBusy(null);
                }
              }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="font-semibold text-ink">{templateLabels[job.template] ?? job.template.replaceAll("_", " ")}</span>
                <span className="text-sm text-ink-soft">{job.attempts} {job.attempts === 1 ? "attempt" : "attempts"}</span>
              </div>
              {job.lastError ? <p className="text-sm text-danger [overflow-wrap:anywhere]">{job.lastError}</p> : null}
              <TextArea
                className="min-h-20"
                hint="8 to 500 characters. Recorded with the retry."
                label="Review reason"
                maxLength={500}
                minLength={8}
                name="reason"
                required
              />
              <div>
                <Button disabled={busy !== null} type="submit" variant="secondary">
                  {busy === job.id ? "Sending..." : "Send again"}
                </Button>
              </div>
            </form>
          </li>
        ))}
      </ul>
    </Card>
  );
}
