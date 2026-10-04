"use client";
import { useState } from "react";
import { fetchJson, getClientErrorMessage } from "@/lib/client/api";

export function FailedNotifications({ jobs }: { jobs: Array<{ id: string; template: string; attempts: number; lastError: string | null }> }) {
  const [remaining, setRemaining] = useState(jobs);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  return <section className="rounded-xl border border-neutral-200 bg-white p-6">
    <h2 className="text-xl font-semibold">Failed notifications</h2>
    {error && <p role="alert">{error}</p>}
    {!remaining.length && <p>No failed business notifications.</p>}
    {remaining.map(job => <form key={job.id} className="my-4 grid gap-2" onSubmit={async event => {
      event.preventDefault(); setError(null); setBusy(job.id);
      const reason = new FormData(event.currentTarget).get("reason");
      try { await fetchJson(`/api/notifications/${job.id}/requeue`, { method: "POST", body: JSON.stringify({ reason }), headers: { "Content-Type": "application/json" } }); setRemaining(items => items.filter(item => item.id !== job.id)); }
      catch (failure) { setError(getClientErrorMessage(failure, "Could not requeue notification")); }
      finally { setBusy(null); }
    }}>
      <p>{job.template} · {job.attempts} attempts · {job.lastError}</p>
      <label>Review reason <input name="reason" required minLength={8} maxLength={500} className="rounded border p-2" /></label>
      <button disabled={busy !== null} className="rounded bg-neutral-900 px-4 py-2 text-white">{busy === job.id ? "Queueing…" : "Requeue"}</button>
    </form>)}
  </section>;
}
