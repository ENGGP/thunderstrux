import { logError, logInfo } from "@/lib/ops/logger";
import { processCompensationRefundBatch } from "@/lib/payments/compensation-refunds";
import { processDisputeReversalBatch } from "@/lib/payments/dispute-reversals";
import { processOrderRefundBatch } from "@/lib/payments/order-refunds";
import { processPayoutBatch } from "@/lib/payouts/payouts";

// The refunds worker's four batches (scripts/process-compensation-refunds.ts).
// PAY-040: each runs whatever the others do, so an error in a refund batch never
// skips payouts; the run still fails afterwards, so worker_failed alerts.
export async function runRefundWorkerBatches(limit: number) {
  const batches = [
    ["compensation_refund", () => processCompensationRefundBatch(limit)],
    ["order_refund", () => processOrderRefundBatch(limit)],
    // PAY-004: lost disputes taken back from the society.
    ["dispute_reversal", () => processDisputeReversalBatch(limit)],
    // PAY-005: societies' money sent to their banks once its events are over (each society hourly).
    ["payouts", () => processPayoutBatch(limit)]
  ] as const;
  const failed: string[] = [];
  let firstError: unknown;
  for (const [name, run] of batches) {
    try {
      logInfo(`${name}.worker.completed`, { processed: (await run()).processed });
    } catch (error) {
      logError(`${name}.worker.batch_failed`, { error });
      failed.push(name);
      firstError ??= error;
    }
  }
  if (firstError) throw Object.assign(new Error(`Refund worker batches failed: ${failed.join(", ")}`), { cause: firstError });
}
