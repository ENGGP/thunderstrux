import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/admin-shell";
import { AdminTime, Panel, tableClass } from "@/components/admin/record";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePlatformPage } from "@/lib/platform/authority";
import { queueThresholds, readQueues, readWorkers, WORKER_STALE_AFTER_SECONDS } from "@/lib/ops/monitor";

export const metadata: Metadata = { title: "Admin operations" };

const minutes = (seconds: number) => (seconds < 3600 ? `${Math.round(seconds / 60)} min` : `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`);

// T54 (board H9, read-only for now): the same readings as `pnpm ops:workers -- status`.
// Pausing and resuming from here arrives with T55; until then use that command.
export default async function AdminOperationsPage() {
  const actor = await requirePlatformPage("platform:monitor", "/admin/operations");
  const now = new Date();
  const [workers, queues] = await Promise.all([readWorkers(now), readQueues(now)]);
  return (
    <AdminShell actor={actor} current="operations">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold">Operations</h1>
        <p className="text-sm text-ink-soft">
          The same state as <code className="font-mono text-[12.5px]">pnpm ops:workers -- status</code>, read <AdminTime value={now} />. Pause or resume with that command.
        </p>
      </div>
      <Panel note="Pausing doesn't stop a run in progress; wait until Running says no" title="Workers">
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead><tr><th scope="col">Job</th><th scope="col">State</th><th scope="col">Running</th><th scope="col">Last success</th><th scope="col">Last failure</th></tr></thead>
            <tbody>
              {workers.map((worker) => (
                <tr key={worker.worker}>
                  <td className="font-mono text-[12.5px]">{worker.worker}</td>
                  <td>{worker.paused ? <StatusBadge label="Paused" status="on-hold" /> : worker.secondsSinceSuccess > WORKER_STALE_AFTER_SECONDS ? <StatusBadge label="Stale" status="under-review" /> : <StatusBadge label="On" status="ready" />}</td>
                  <td>{worker.running ? "Yes" : "No"}</td>
                  <td><AdminTime value={worker.lastSucceededAt} /></td>
                  <td><AdminTime value={worker.lastFailedAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel note="The monitor alerts when the oldest item passes its limit" title="Queues">
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead><tr><th scope="col">Queue</th><th className="text-right" scope="col">Waiting</th><th className="text-right" scope="col">Oldest</th><th className="text-right" scope="col">Stuck</th><th className="text-right" scope="col">Alerts at</th></tr></thead>
            <tbody>
              {queues.map((queue) => {
                const late = queue.oldestAgeSeconds > queueThresholds[queue.queue];
                return (
                  <tr key={queue.queue}>
                    <td className="font-mono text-[12.5px]">{queue.queue}</td>
                    <td className="text-right tabular-nums">{queue.backlog}</td>
                    <td className={`text-right tabular-nums ${late ? "font-semibold text-warning" : ""}`}>{queue.backlog ? minutes(queue.oldestAgeSeconds) : "—"}</td>
                    <td className="text-right tabular-nums">{queue.stuck}</td>
                    <td className="text-right tabular-nums">{minutes(queueThresholds[queue.queue])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </AdminShell>
  );
}
