"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

export function FailedNotifications({ jobs }: { jobs: Array<{ id: string; template: string; attempts: number; lastError: string | null }> }) {
  const [remaining, setRemaining] = useState(jobs);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  return <section className="grid gap-4 rounded-card border border-line bg-surface p-6">
    {error && <Notice role="alert" tone="danger">{error}</Notice>}
    {!remaining.length && <p className="text-ink-soft">No failed business notifications.</p>}
    {remaining.map(job => <form key={job.id} className="grid gap-3 border-b border-line pb-4 last:border-0 last:pb-0" onSubmit={async event => {
      event.preventDefault(); setError(null); setBusy(job.id);
      const reason = new FormData(event.currentTarget).get("reason");
      try { await fetchJson(`/api/notifications/${job.id}/requeue`, { method: "POST", body: JSON.stringify({ reason }), headers: { "Content-Type": "application/json" } }); setRemaining(items => items.filter(item => item.id !== job.id)); }
      catch (failure) { setError(getClientErrorMessage(failure, "Could not requeue notification")); }
      finally { setBusy(null); }
    }}>
      <p className="text-sm text-ink-soft">{job.template} · {job.attempts} attempts · {job.lastError}</p>
      <label className="grid gap-1.5 text-sm font-semibold text-ink">Review reason <input name="reason" required minLength={8} maxLength={500} className="h-11 rounded-control border border-line-strong bg-surface px-3 text-base font-normal" /></label>
      <div><Button disabled={busy !== null} type="submit">{busy === job.id ? "Queueing…" : "Requeue"}</Button></div>
    </form>)}
  </section>;
}
