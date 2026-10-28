import { afterEach, describe, expect, test, vi } from "vitest";
import { runRefundWorkerBatches } from "@/lib/payments/refund-worker";

// PAY-040: the refunds worker's batches run whatever the others do.
const batches = vi.hoisted(() => ({ compensation: vi.fn(), order: vi.fn(), reversal: vi.fn(), payouts: vi.fn() }));
vi.mock("@/lib/payments/compensation-refunds", () => ({ processCompensationRefundBatch: batches.compensation }));
vi.mock("@/lib/payments/order-refunds", () => ({ processOrderRefundBatch: batches.order }));
vi.mock("@/lib/payments/dispute-reversals", () => ({ processDisputeReversalBatch: batches.reversal }));
vi.mock("@/lib/payouts/payouts", () => ({ processPayoutBatch: batches.payouts }));

afterEach(() => { for (const mock of Object.values(batches)) mock.mockReset(); });

describe("refunds worker batches", () => {
  test("a batch that throws doesn't skip the rest, and the run still fails afterwards", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    batches.compensation.mockRejectedValue(new Error("database unavailable"));
    for (const later of [batches.order, batches.reversal, batches.payouts]) later.mockResolvedValue({ processed: 0 });

    await expect(runRefundWorkerBatches(25)).rejects.toThrow("Refund worker batches failed: compensation_refund");
    expect(batches.order).toHaveBeenCalledWith(25);
    expect(batches.reversal).toHaveBeenCalledWith(25);
    expect(batches.payouts).toHaveBeenCalledWith(25);
  });

  test("when every batch succeeds the run succeeds", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    for (const batch of Object.values(batches)) batch.mockResolvedValue({ processed: 1 });
    await expect(runRefundWorkerBatches(5)).resolves.toBeUndefined();
  });
});
