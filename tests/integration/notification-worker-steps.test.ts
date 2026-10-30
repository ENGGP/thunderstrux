import { afterEach, expect, test, vi } from "vitest";

// The job's steps fail one at a time. It starts on import, so the run is captured
// from `runWorker` instead (the lease and timeout are in worker-contract.test.ts).
const steps = vi.hoisted(() => ({
  runWorker: vi.fn(),
  fanOutEventChanges: vi.fn(async () => 0),
  queueMembershipNotices: vi.fn(async () => 0),
  cleanUpExpiredTokens: vi.fn(async () => ({})),
  processNotificationBatch: vi.fn(async () => ({}))
}));
vi.mock("@/lib/ops/worker", () => ({ runWorker: steps.runWorker }));
vi.mock("@/lib/events/event-changes", () => ({ fanOutEventChanges: steps.fanOutEventChanges }));
vi.mock("@/lib/memberships/reminders", () => ({ queueMembershipNotices: steps.queueMembershipNotices }));
vi.mock("@/lib/security/token-cleanup", () => ({ cleanUpExpiredTokens: steps.cleanUpExpiredTokens }));
vi.mock("@/lib/email/notification-outbox", () => ({ processNotificationBatch: steps.processNotificationBatch }));

// @ts-expect-error The extension picks the job itself over the `.mjs` loader beside it.
await import("@/scripts/process-notifications.ts");
const [, run] = steps.runWorker.mock.calls[0] as [string, () => Promise<void>];

afterEach(() => { process.exitCode = undefined; });

test.each([
  ["event_changes", steps.fanOutEventChanges],
  ["membership_notices", steps.queueMembershipNotices],
  ["token_cleanup", steps.cleanUpExpiredTokens]
] as const)("a failed %s step alerts, without its error, and sending still runs (DEF-069)", async (step, failing) => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  failing.mockRejectedValueOnce(new Error("Notice text for private@example.com"));
  steps.processNotificationBatch.mockClear();

  await run();

  const alerts = error.mock.calls.map(([line]) => JSON.parse(String(line))).filter((entry) => entry.event === "notification_step_failed");
  expect(alerts).toEqual([expect.objectContaining({ step, dedupeKey: `notification_step_failed:${step}` })]);
  expect(JSON.stringify(error.mock.calls)).not.toContain("private@example.com");
  expect(process.exitCode).toBe(1);
  expect(steps.processNotificationBatch).toHaveBeenCalledTimes(1);
});
