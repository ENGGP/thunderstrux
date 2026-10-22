import { emitOperationalAlert } from "@/lib/ops/alerts";
import { runWorker } from "@/lib/ops/worker";
import { processCheckoutAttemptRecoveryBatch } from "@/lib/payments/checkout-attempt-recovery";

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
void runWorker("checkout-recovery", async () => {
  try {
    return { ...(await processCheckoutAttemptRecoveryBatch({ limit: batchLimit() })) };
  } catch (error) {
    emitOperationalAlert("checkout_attempt_recovery_failed", { error });
    throw error;
  }
});
