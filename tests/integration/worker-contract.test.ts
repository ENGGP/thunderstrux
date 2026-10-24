import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { runOperationsMonitor, readQueues } from "@/lib/ops/monitor";
import { runWorker, scheduledWorkers } from "@/lib/ops/worker";

// T42: the worker contract (lease, pause, timeout, failure alert) and the
// monitor's backlog, stuck-item and stale-job alerts, received over HTTP.

type Alert = { event: string; dedupeKey: string; details: Record<string, unknown> };
// The setup blocks network calls in each test; the receiver is local, so its tests restore fetch.
const realFetch = globalThis.fetch;

async function alertReceiver() {
  const received: Alert[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    received.push(JSON.parse(body));
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/alerts`;
  vi.stubGlobal("fetch", realFetch);
  return { received, close: () => new Promise((resolve) => server.close(resolve)) };
}

const quiet = () => ({
  info: vi.spyOn(console, "info").mockImplementation(() => {}),
  warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
  error: vi.spyOn(console, "error").mockImplementation(() => {})
});
const events = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])).event as string);
const run = (name: Parameters<typeof runWorker>[0], job: Parameters<typeof runWorker>[1], options: Parameters<typeof runWorker>[2] = {}) =>
  runWorker(name, job, { timeoutMs: 10_000, disconnect: false, ...options });

afterEach(() => {
  delete process.env.ALERT_WEBHOOK_URL;
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("worker contract (T42)", () => {
  test("one run at a time: a second run is skipped while the first holds the lease, which it then releases", async () => {
    quiet();
    let finishFirst!: () => void;
    const first = run("email-outbox", () => new Promise<void>((resolve) => { finishFirst = resolve; }));
    await vi.waitFor(async () => expect((await prisma.workerLease.findUnique({ where: { name: "email-outbox" } }))?.holder).toBeTruthy());
    const second = vi.fn();
    expect(await run("email-outbox", second)).toBe("skipped_running");
    expect(second).not.toHaveBeenCalled();
    finishFirst();
    expect(await first).toBe("succeeded");
    expect(await prisma.workerLease.findUniqueOrThrow({ where: { name: "email-outbox" } })).toMatchObject({ holder: null, leasedUntil: null, lastSucceededAt: expect.any(Date), lastError: null });
  });

  test("a crashed run's lapsed lease is reclaimed by the next run", async () => {
    const { warn } = quiet();
    await prisma.workerLease.create({ data: { name: "refunds", holder: "crashed-run", leasedUntil: new Date(Date.now() - 1000) } });
    expect(await run("refunds", async () => ({ processed: 0 }))).toBe("succeeded");
    expect(events(warn)).toContain("worker.lease_reclaimed");
  });

  test("pausing every job or one job skips its runs until resumed", async () => {
    quiet();
    const job = vi.fn(async () => {});
    await prisma.workerLease.create({ data: { name: "all", pausedAt: new Date(), pauseReason: "Restoring a backup" } });
    expect(await run("notifications", job)).toBe("skipped_paused");
    await prisma.workerLease.update({ where: { name: "all" }, data: { pausedAt: null } });
    await prisma.workerLease.upsert({ where: { name: "notifications" }, create: { name: "notifications", pausedAt: new Date() }, update: { pausedAt: new Date() } });
    expect(await run("notifications", job)).toBe("skipped_paused");
    expect(await run("stale-orders", job)).toBe("succeeded");
    expect(job).toHaveBeenCalledTimes(1);
  });

  test("a failing run records the failure and its alert reaches the receiver, redacted", async () => {
    quiet();
    const receiver = await alertReceiver();
    try {
      expect(await run("checkout-recovery", async () => { throw Object.assign(new Error("Stripe unreachable"), { token: "secret-token" }); })).toBe("failed");
      expect(process.exitCode).toBe(1);
      expect(await prisma.workerLease.findUniqueOrThrow({ where: { name: "checkout-recovery" } })).toMatchObject({ holder: null, lastFailedAt: expect.any(Date), lastError: "Error: Stripe unreachable" });
      expect(receiver.received).toEqual([expect.objectContaining({ event: "worker_failed", dedupeKey: "worker_failed:checkout-recovery", details: expect.objectContaining({ worker: "checkout-recovery" }) })]);
      expect(JSON.stringify(receiver.received)).not.toContain("secret-token");
    } finally {
      await receiver.close();
    }
  });

  test("an unreachable receiver is logged and never fails the run", async () => {
    const { warn } = quiet();
    process.env.ALERT_WEBHOOK_URL = "http://127.0.0.1:9/alerts";
    expect(await run("monitor", async () => { throw new Error("boom"); })).toBe("failed");
    expect(events(warn)).toContain("ops.alert.delivery_failed");
  });

  test("a run past its timeout is stopped, alerted and the process told to exit", async () => {
    const { error } = quiet();
    const exit = vi.fn();
    expect(await run("stale-orders", () => new Promise(() => {}), { timeoutMs: 50, exit })).toBe("timed_out");
    expect(exit).toHaveBeenCalledWith(1);
    expect(events(error)).toEqual(expect.arrayContaining(["worker.timed_out", "worker_timed_out"]));
    // Its lease is released, so the next scheduled run isn't blocked.
    expect((await prisma.workerLease.findUniqueOrThrow({ where: { name: "stale-orders" } })).holder).toBeNull();
  });
});

describe("operations monitor (T42)", () => {
  const notice = (data: Partial<{ status: string; createdAt: Date; processingStartedAt: Date }>) => prisma.notificationOutbox.create({
    data: { eventKey: `monitor-${Math.random()}`, recipient: "member@example.com", template: "business_notice", privacy: "security", encryptedPayload: "x", ...data }
  });
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

  test("reports each queue's backlog, oldest waiting item and stuck items, and alerts past the thresholds once per 30 minutes", async () => {
    const { info } = quiet();
    const receiver = await alertReceiver();
    try {
      await notice({ createdAt: minutesAgo(20) });
      await notice({ status: "processing", processingStartedAt: minutesAgo(20) });
      const reading = (await readQueues()).find((queue) => queue.queue === "notification_outbox");
      expect(reading).toMatchObject({ backlog: 1, stuck: 1 });
      expect(reading!.oldestAgeSeconds).toBeGreaterThanOrEqual(20 * 60);

      expect(await run("monitor", () => runOperationsMonitor())).toBe("succeeded");
      expect(receiver.received.map((alert) => alert.dedupeKey).sort()).toEqual(["queue_backlog_high:notification_outbox", "queue_processing_stuck:notification_outbox"]);
      expect(info.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0]))).filter((entry) => entry.metricName === "queue.oldest_age_seconds")).toHaveLength(8);

      // Still firing: no repeat within 30 minutes.
      await run("monitor", () => runOperationsMonitor());
      expect(receiver.received).toHaveLength(2);
      // Cleared, then back: it alerts again at once.
      await prisma.notificationOutbox.deleteMany();
      await run("monitor", () => runOperationsMonitor());
      await notice({ createdAt: minutesAgo(20) });
      await run("monitor", () => runOperationsMonitor());
      expect(receiver.received.map((alert) => alert.dedupeKey)).toEqual(expect.arrayContaining(["queue_backlog_high:notification_outbox"]));
      expect(receiver.received).toHaveLength(3);
    } finally {
      await receiver.close();
    }
  });

  test("a job that hasn't succeeded for ten minutes is reported stale, unless it is paused", async () => {
    quiet();
    const receiver = await alertReceiver();
    try {
      for (const name of scheduledWorkers) await prisma.workerLease.create({ data: { name, lastSucceededAt: name === "email-outbox" ? minutesAgo(60) : new Date() } });
      await run("monitor", () => runOperationsMonitor());
      expect(receiver.received.map((alert) => alert.dedupeKey)).toEqual(["worker_stale:email-outbox"]);

      await prisma.workerLease.update({ where: { name: "email-outbox" }, data: { pausedAt: new Date() } });
      await prisma.workerLease.update({ where: { name: "monitor" }, data: { alertState: {} } });
      await run("monitor", () => runOperationsMonitor());
      expect(receiver.received).toHaveLength(1);
    } finally {
      await receiver.close();
    }
  });
});
