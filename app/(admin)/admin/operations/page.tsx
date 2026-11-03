import type { Metadata } from "next";
import { AdminActions } from "@/components/admin/action-dialog";
import { AdminShell, adminEnvironment } from "@/components/admin/admin-shell";
import { IdChip } from "@/components/admin/id-chip";
import { AdminTime, Panel, tableClass } from "@/components/admin/record";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePlatformPage } from "@/lib/platform/authority";
import { queueThresholds, readQueues, readWorkers, WORKER_STALE_AFTER_SECONDS } from "@/lib/ops/monitor";
import { readLastIntegrityAudit, readPauseAll } from "@/lib/platform/operations";
import { personLabel } from "@/lib/platform/records";
import { integrityAuditSpec, workerSpec } from "@/lib/platform/specs";

export const metadata: Metadata = { title: "Admin operations" };

const minutes = (seconds: number) => (seconds < 3600 ? `${Math.round(seconds / 60)} min` : `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`);

// T54 (board H9): the same readings as `pnpm ops:workers -- status`. T55: pause
// and resume each job or all of them, and run the integrity audit.
export default async function AdminOperationsPage() {
  const actor = await requirePlatformPage("platform:monitor", "/admin/operations");
  const now = new Date();
  const [workers, queues, pauseAll, audit] = await Promise.all([readWorkers(now), readQueues(now), readPauseAll(), readLastIntegrityAudit()]);
  const env = adminEnvironment().label;
  const all = workerSpec({ role: actor.role, worker: "all", paused: Boolean(pauseAll?.pausedAt) });
  const run = integrityAuditSpec(actor.role);
  const unexplained = audit?.checks.filter((check) => check.count > 0 && !check.legacy).length ?? 0;
  const legacy = audit?.checks.filter((check) => check.count > 0 && check.legacy).length ?? 0;
  return (
    <AdminShell actor={actor} current="operations">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold">Operations</h1>
          <p className="text-sm text-ink-soft">
            The same state as <code className="font-mono text-[12.5px]">pnpm ops:workers -- status</code>, read <AdminTime value={now} />.
            {pauseAll?.pausedAt ? <> Every job is paused: “{pauseAll.pauseReason}”.</> : null}
          </p>
        </div>
        {all ? <AdminActions env={env} specs={[all]} /> : null}
      </div>
      <Panel note="Pausing doesn't stop a run in progress; wait until Running says no" title="Workers">
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead><tr><th scope="col">Job</th><th scope="col">State</th><th scope="col">Running</th><th scope="col">Last success</th><th scope="col">Last failure</th>{all ? <th scope="col"><span className="sr-only">Action</span></th> : null}</tr></thead>
            <tbody>
              {workers.map((worker) => (
                <tr key={worker.worker}>
                  <td className="font-mono text-[12.5px]">{worker.worker}</td>
                  <td>
                    {worker.paused ? <StatusBadge label="Paused" status="on-hold" /> : worker.secondsSinceSuccess > WORKER_STALE_AFTER_SECONDS ? <StatusBadge label="Stale" status="under-review" /> : <StatusBadge label="On" status="ready" />}
                    {worker.pauseReason ? <div className="mt-1 text-[12.5px] text-ink-muted">“{worker.pauseReason}”</div> : null}
                  </td>
                  <td>{worker.running ? "Yes" : "No"}</td>
                  <td><AdminTime value={worker.lastSucceededAt} /></td>
                  <td><AdminTime value={worker.lastFailedAt} /></td>
                  {all ? <td><AdminActions env={env} specs={[workerSpec({ role: actor.role, worker: worker.worker, paused: Boolean(worker.pausedAt) })!]} /></td> : null}
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
      <Panel action={run ? <AdminActions env={env} specs={[run]} /> : undefined} note={audit ? <>Read-only checks of the database. Last run <AdminTime value={audit.at} /> by {audit.by ? personLabel(audit.by) : "the CLI"}.</> : "Read-only checks of the database. Not run from here yet."} title="Integrity audit">
        {audit ? (
          <>
            <p className="flex flex-wrap gap-x-6 gap-y-1 border-b border-[#efedf3] px-4 py-3 text-sm">
              <span><strong>{unexplained}</strong> unexplained</span><span><strong>{legacy}</strong> explained as older than their feature</span><span className="text-ink-muted">5 runs an hour at most</span>
            </p>
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead><tr><th scope="col">Check</th><th scope="col">Class</th><th className="text-right" scope="col">Rows</th><th scope="col">Samples</th></tr></thead>
                <tbody>
                  {[...audit.checks].sort((a, b) => b.count - a.count).map((check) => (
                    <tr key={check.name}>
                      <td className="font-mono text-[12.5px]">{check.name}</td>
                      <td className="font-mono text-[12.5px]">{check.classification}</td>
                      <td className="text-right tabular-nums">{check.count}{check.count && check.legacy ? <span className="text-ink-muted"> legacy</span> : null}</td>
                      <td><span className="flex flex-wrap gap-1.5">{check.sampleIds.length ? check.sampleIds.map((id) => <IdChip key={id} label="sample id" value={id} />) : <span className="text-ink-muted">—</span>}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </Panel>
    </AdminShell>
  );
}
