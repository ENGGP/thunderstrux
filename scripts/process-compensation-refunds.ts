import { logInfo } from "@/lib/ops/logger";
import { runWorker } from "@/lib/ops/worker";
import { processCompensationRefundBatch } from "@/lib/payments/compensation-refunds";
import { processDisputeReversalBatch } from "@/lib/payments/dispute-reversals";
import { processPayoutBatch } from "@/lib/payouts/payouts";
import { processOrderRefundBatch } from "@/lib/payments/order-refunds";

function batchLimit() {
  const argument = process.argv.find((value) => value.startsWith("--limit="));
  if (!argument) return 25;
  const parsed = Number(argument.slice("--limit=".length));
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error("--limit must be an integer from 1 to 100");
  }
  return parsed;
}

// T42: one run at a time, pausable, with a timeout and an alert on failure.
void runWorker("refunds", async () => {
  const result = await processCompensationRefundBatch(batchLimit());
  logInfo("compensation_refund.worker.completed", result);
  const ordinary = await processOrderRefundBatch(batchLimit());
  logInfo("order_refund.worker.completed", ordinary);
  // PAY-004: lost disputes taken back from the society.
  const reversals = await processDisputeReversalBatch(batchLimit());
  logInfo("dispute_reversal.worker.completed", { processed: reversals.processed });
  // PAY-005: societies' money sent to their banks once its events are over (each society hourly).
  const payouts = await processPayoutBatch(batchLimit());
  logInfo("payouts.worker.completed", { processed: payouts.processed });
});
