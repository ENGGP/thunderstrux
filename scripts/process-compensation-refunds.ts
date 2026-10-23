import { logInfo } from "@/lib/ops/logger";
import { runWorker } from "@/lib/ops/worker";
import { processCompensationRefundBatch } from "@/lib/payments/compensation-refunds";
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
});
