import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { emitOperationalAlert, type OperationalAlertName } from "@/lib/ops/alerts";
import { emitMetric } from "@/lib/ops/metrics";
import { ALL_WORKERS, scheduledWorkers } from "@/lib/ops/worker";

// T42: every minute the monitor reads each queue's backlog, oldest waiting
// item and items stuck in processing, and when each job last succeeded. The
// thresholds below raise alerts; Production Operations says who responds.

const minutes = (count: number) => count * 60;

// Oldest waiting item before an alert, in seconds.
export const queueThresholds = {
  email_outbox: minutes(15),
  notification_outbox: minutes(15),
  checkout_attempts: minutes(30),
  compensation_refunds: minutes(60),
  order_refunds: minutes(60),
  ticket_holds: minutes(10),
  commerce_checkouts: minutes(30)
} as const;
export type QueueName = keyof typeof queueThresholds;

// An item processing longer than this lost its worker; lease recovery should have requeued it.
export const STUCK_AFTER_SECONDS = minutes(15);
// A job that hasn't succeeded for this long has stopped running.
export const WORKER_STALE_AFTER_SECONDS = minutes(10);
// A firing alert repeats this often, not on every run.
export const ALERT_REPEAT_SECONDS = minutes(30);

type Reading = { queue: QueueName; backlog: number; oldestAgeSeconds: number; stuck: number };
type Row = { backlog: bigint; oldest: Date | null; stuck: bigint };

// Each query counts what is waiting, the oldest of it (since it was created,
// or since it should have closed), and what has been processing too long.
const queueQueries: Record<QueueName, (stuckBefore: Date) => Prisma.Sql> = {
  email_outbox: (stuckBefore) => Prisma.sql`SELECT COUNT(*) FILTER (WHERE "status" = 'pending') AS backlog, MIN("createdAt") FILTER (WHERE "status" = 'pending') AS oldest,
    COUNT(*) FILTER (WHERE "status" = 'processing' AND "processingStartedAt" < ${stuckBefore}) AS stuck FROM "EmailOutbox" WHERE "status" IN ('pending', 'processing')`,
  notification_outbox: (stuckBefore) => Prisma.sql`SELECT COUNT(*) FILTER (WHERE "status" = 'pending') AS backlog, MIN("createdAt") FILTER (WHERE "status" = 'pending') AS oldest,
    COUNT(*) FILTER (WHERE "status" = 'processing' AND "processingStartedAt" < ${stuckBefore}) AS stuck FROM "NotificationOutbox" WHERE "status" IN ('pending', 'processing')`,
  checkout_attempts: () => Prisma.sql`SELECT COUNT(*) AS backlog, MIN("createdAt") AS oldest, 0::bigint AS stuck FROM "CheckoutAttempt" WHERE "state" = 'provider_uncertain'`,
  compensation_refunds: (stuckBefore) => Prisma.sql`SELECT COUNT(*) FILTER (WHERE "state" IN ('auto_queued', 'refund_pending')) AS backlog, MIN("createdAt") FILTER (WHERE "state" IN ('auto_queued', 'refund_pending')) AS oldest,
    COUNT(*) FILTER (WHERE "state" = 'auto_processing' AND "processingStartedAt" < ${stuckBefore}) AS stuck FROM "CompensationRefundJob" WHERE "state" IN ('auto_queued', 'auto_processing', 'refund_pending')`,
  order_refunds: (stuckBefore) => Prisma.sql`SELECT COUNT(*) AS backlog, MIN("createdAt") AS oldest,
    COUNT(*) FILTER (WHERE "processingStartedAt" < ${stuckBefore}) AS stuck FROM "RefundRequest" WHERE "status" IN ('pending', 'uncertain')`,
  ticket_holds: () => Prisma.sql`SELECT COUNT(*) AS backlog, MIN("expiresAt") AS oldest, 0::bigint AS stuck FROM "TicketReservation" WHERE "status" = 'active' AND "expiresAt" < now()`,
  commerce_checkouts: () => Prisma.sql`SELECT COUNT(*) AS backlog, MIN("expiresAt") AS oldest, 0::bigint AS stuck FROM "CommerceOrder" WHERE "status" = 'pending' AND "expiresAt" < now()`
};

export async function readQueues(now = new Date()): Promise<Reading[]> {
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_SECONDS * 1000);
  return Promise.all((Object.keys(queueQueries) as QueueName[]).map(async (queue) => {
    const [row] = await prisma.$queryRaw<Row[]>(queueQueries[queue](stuckBefore));
    const oldestAgeSeconds = row.oldest ? Math.max(0, Math.floor((now.getTime() - row.oldest.getTime()) / 1000)) : 0;
    return { queue, backlog: Number(row.backlog), oldestAgeSeconds, stuck: Number(row.stuck) };
  }));
}

export async function readWorkers(now = new Date()) {
  const rows = await prisma.workerLease.findMany();
  const byName = new Map(rows.map((row) => [row.name, row]));
  const allPaused = byName.get(ALL_WORKERS)?.pausedAt ?? null;
  // A job that has never run counts from when the monitor first ran.
  const since = byName.get("monitor")?.createdAt ?? now;
  return scheduledWorkers.filter((name) => name !== "monitor").map((name) => {
    const row = byName.get(name);
    const lastSucceededAt = row?.lastSucceededAt ?? null;
    const reference = lastSucceededAt ?? row?.createdAt ?? since;
    return {
      worker: name,
      paused: Boolean(allPaused || row?.pausedAt),
      lastSucceededAt,
      lastFailedAt: row?.lastFailedAt ?? null,
      running: Boolean(row?.leasedUntil && row.leasedUntil > now),
      secondsSinceSuccess: Math.max(0, Math.floor((now.getTime() - reference.getTime()) / 1000))
    };
  });
}

type Firing = { key: string; alert: OperationalAlertName; details: Record<string, unknown> };

export async function runOperationsMonitor(now = new Date()) {
  const [queues, workers] = await Promise.all([readQueues(now), readWorkers(now)]);
  const firing: Firing[] = [];
  for (const reading of queues) {
    emitMetric("queue.backlog", reading.backlog, { queue: reading.queue });
    emitMetric("queue.oldest_age_seconds", reading.oldestAgeSeconds, { queue: reading.queue });
    emitMetric("queue.stuck", reading.stuck, { queue: reading.queue });
    const thresholdSeconds = queueThresholds[reading.queue];
    if (reading.oldestAgeSeconds > thresholdSeconds) firing.push({ key: `queue_backlog_high:${reading.queue}`, alert: "queue_backlog_high", details: { ...reading, thresholdSeconds } });
    if (reading.stuck > 0) firing.push({ key: `queue_processing_stuck:${reading.queue}`, alert: "queue_processing_stuck", details: { ...reading, thresholdSeconds: STUCK_AFTER_SECONDS } });
  }
  for (const worker of workers) {
    emitMetric("worker.seconds_since_success", worker.secondsSinceSuccess, { worker: worker.worker });
    // A paused job is meant to be quiet.
    if (!worker.paused && worker.secondsSinceSuccess > WORKER_STALE_AFTER_SECONDS) {
      firing.push({ key: `worker_stale:${worker.worker}`, alert: "worker_stale", details: { worker: worker.worker, secondsSinceSuccess: worker.secondsSinceSuccess, thresholdSeconds: WORKER_STALE_AFTER_SECONDS } });
    }
  }

  // Send what is newly firing or due a repeat; forget what has cleared, so it alerts again if it returns.
  const monitor = await prisma.workerLease.findUnique({ where: { name: "monitor" }, select: { alertState: true } });
  const previous = (monitor?.alertState ?? {}) as Record<string, string>;
  const next: Record<string, string> = {};
  let sent = 0;
  for (const item of firing) {
    const last = previous[item.key] ? Date.parse(previous[item.key]) : 0;
    if (now.getTime() - last >= ALERT_REPEAT_SECONDS * 1000) {
      emitOperationalAlert(item.alert, { ...item.details, dedupeKey: item.key });
      next[item.key] = now.toISOString();
      sent += 1;
    } else {
      next[item.key] = previous[item.key];
    }
  }
  await prisma.workerLease.updateMany({ where: { name: "monitor" }, data: { alertState: next } });
  return { queues: queues.length, firing: firing.length, alertsSent: sent };
}
