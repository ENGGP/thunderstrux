import { describe, expect, test, vi } from "vitest";

// PAY-046: the stale-order job closes checkouts whose hold has ended before the
// sweep, which can take 45 s. Each expiry still asks Stripe first (PAY-024).

const run = vi.hoisted(() => ({ steps: [] as string[], job: null as null | (() => Promise<Record<string, unknown>>) }));

vi.mock("@/lib/ops/worker", () => ({ runWorker: (_name: string, job: () => Promise<Record<string, unknown>>) => { run.job = job; } }));
vi.mock("@/lib/security/staff-mfa", () => ({ deleteExpiredMfaGrants: async () => 0 }));
vi.mock("@/lib/payments/checkout-settlement", () => ({ sweepPendingCheckouts: async () => { run.steps.push("sweep"); return { checked: 0 }; } }));
vi.mock("@/lib/orders/stale-orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orders/stale-orders")>()),
  processStaleOrderCleanupBatch: async ({ dryRun }: { dryRun: boolean }) => { run.steps.push(dryRun ? "tickets, dry run" : "tickets"); return { stripeDeferred: 0 }; },
  expireStaleCommerceOrders: async () => { run.steps.push("commerce"); return { expired: 0, considered: 0, stripeDeferred: 0 }; }
}));

// The .ts file itself: bare, this resolves to the .mjs wrapper that production starts.
const script = "@/scripts/process-stale-orders.ts";

async function runJob(...args: string[]) {
  vi.resetModules();
  run.steps = [];
  const { argv } = process;
  process.argv = ["node", "process-stale-orders", ...args];
  await import(/* @vite-ignore */ script);
  const result = await run.job?.();
  process.argv = argv;
  return result;
}

describe("the stale-order job", () => {
  test("expires tickets and commerce orders before the sweep", async () => {
    await runJob();
    expect(run.steps).toEqual(["tickets", "commerce", "sweep"]);
  });

  test("a dry run expires nothing and never asks Stripe", async () => {
    await expect(runJob("--dry-run")).resolves.toMatchObject({ sweep: null, commerceOrdersExpired: 0 });
    expect(run.steps).toEqual(["tickets, dry run"]);
  });
});
