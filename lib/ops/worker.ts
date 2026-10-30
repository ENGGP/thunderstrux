import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { emitOperationalAlert, flushOperationalAlerts } from "@/lib/ops/alerts";
import { logError, logInfo, logWarn } from "@/lib/ops/logger";
import { emitMetric } from "@/lib/ops/metrics";

// T42: the contract every scheduled job runs under. One run at a time per job
// (a database lease, so it holds across containers and hosts), a pause switch
// for restores and reconciliation, a hard timeout, and a metric and alert for
// every outcome. The jobs themselves stay bounded one-shot batches.

export const scheduledWorkers = ["email-outbox", "notifications", "stale-orders", "refunds", "checkout-recovery", "monitor"] as const;
export type WorkerName = (typeof scheduledWorkers)[number];
// Pausing "all" pauses every job.
export const ALL_WORKERS = "all";

export const DEFAULT_WORKER_TIMEOUT_MS = 5 * 60_000;
// The lease outlives the timeout a little, so a timed-out run has exited before another starts.
const LEASE_GRACE_MS = 30_000;

export function workerTimeoutMs() {
  const seconds = Number(process.env.WORKER_TIMEOUT_SECONDS ?? DEFAULT_WORKER_TIMEOUT_MS / 1000);
  if (!Number.isInteger(seconds) || seconds < 10 || seconds > 3600) throw new Error("WORKER_TIMEOUT_SECONDS must be an integer from 10 to 3600");
  return seconds * 1000;
}

type WorkerOptions = {
  timeoutMs?: number;
  // Tests replace these; a real run exits the process on timeout and disconnects at the end.
  exit?: (code: number) => void;
  disconnect?: boolean;
  leaseGraceMs?: number;
};

export type WorkerOutcome = "succeeded" | "failed" | "skipped_paused" | "skipped_running" | "timed_out";

const errorSummary = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : "unknown error").slice(0, 200);

export async function pausedBy(name: string) {
  const rows = await prisma.workerLease.findMany({ where: { name: { in: [name, ALL_WORKERS] }, pausedAt: { not: null } }, select: { name: true, pauseReason: true } });
  return rows[0] ?? null;
}

// Takes the lease unless another run holds an unexpired one. Returns the holder
// it replaced when that run's lease had lapsed (it crashed or timed out).
async function acquireLease(name: string, holder: string, leaseMs: number) {
  const rows = await prisma.$queryRaw<Array<{ previousHolder: string | null }>>`
    WITH previous AS (SELECT "holder" FROM "WorkerLease" WHERE "name" = ${name})
    INSERT INTO "WorkerLease" ("name", "holder", "leasedUntil", "lastStartedAt", "updatedAt")
    VALUES (${name}, ${holder}, now() + ${leaseMs} * interval '1 millisecond', now(), now())
    ON CONFLICT ("name") DO UPDATE SET "holder" = EXCLUDED."holder", "leasedUntil" = EXCLUDED."leasedUntil", "lastStartedAt" = now(), "updatedAt" = now()
    WHERE "WorkerLease"."leasedUntil" IS NULL OR "WorkerLease"."leasedUntil" < now()
    RETURNING (SELECT "holder" FROM previous) AS "previousHolder"`;
  return rows.length ? { acquired: true as const, reclaimedFrom: rows[0].previousHolder } : { acquired: false as const };
}

function finish(name: string, holder: string, outcome: "succeeded" | "failed" | "timed_out", durationMs: number, error?: unknown) {
  const now = new Date();
  // A timed-out job may still be running, so its lease stays until it lapses (DEF-070).
  const release = outcome === "timed_out" ? {} : { holder: null, leasedUntil: null };
  return prisma.workerLease.updateMany({
    where: { name, holder },
    data: outcome === "succeeded"
      ? { ...release, lastSucceededAt: now, lastDurationMs: durationMs, lastError: null }
      : { ...release, lastFailedAt: now, lastDurationMs: durationMs, lastError: errorSummary(error) }
  });
}

export async function runWorker(name: WorkerName, job: () => Promise<Record<string, unknown> | void>, options: WorkerOptions = {}): Promise<WorkerOutcome> {
  const timeoutMs = options.timeoutMs ?? workerTimeoutMs();
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const holder = randomUUID();
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  let outcome: WorkerOutcome = "failed";
  try {
    const pause = await pausedBy(name);
    if (pause) {
      logInfo("worker.paused", { worker: name, pausedBy: pause.name, reason: pause.pauseReason });
      return (outcome = "skipped_paused");
    }
    const lease = await acquireLease(name, holder, timeoutMs + (options.leaseGraceMs ?? LEASE_GRACE_MS));
    if (!lease.acquired) {
      logInfo("worker.skipped_running", { worker: name });
      return (outcome = "skipped_running");
    }
    if (lease.reclaimedFrom) logWarn("worker.lease_reclaimed", { worker: name, previousHolder: lease.reclaimedFrom });

    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`Worker ${name} ran past ${timeoutMs} ms`), { timedOut: true })), timeoutMs);
    });
    const result = await Promise.race([job(), timedOut]);
    await finish(name, holder, "succeeded", Date.now() - started);
    logInfo("worker.succeeded", { worker: name, durationMs: Date.now() - started, ...(result ?? {}) });
    return (outcome = "succeeded");
  } catch (error) {
    const timedOut = (error as { timedOut?: boolean })?.timedOut === true;
    outcome = timedOut ? "timed_out" : "failed";
    logError(timedOut ? "worker.timed_out" : "worker.failed", { worker: name, durationMs: Date.now() - started, error });
    emitOperationalAlert(timedOut ? "worker_timed_out" : "worker_failed", { worker: name, dedupeKey: `${timedOut ? "worker_timed_out" : "worker_failed"}:${name}`, error });
    await finish(name, holder, outcome, Date.now() - started, error).catch(() => undefined);
    process.exitCode = 1;
    return outcome;
  } finally {
    clearTimeout(timer);
    emitMetric("worker.run", 1, { worker: name, outcome });
    emitMetric("worker.duration_ms", Date.now() - started, { worker: name, outcome });
    await flushOperationalAlerts();
    if (options.disconnect !== false) await prisma.$disconnect();
    // A timed-out job may still hold the event loop; leave rather than overlap the next run.
    if (outcome === "timed_out") exit(1);
  }
}
