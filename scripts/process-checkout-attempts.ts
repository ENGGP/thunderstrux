import { prisma } from "@/lib/db";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logError, logInfo } from "@/lib/ops/logger";
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

async function main() {
  const result = await processCheckoutAttemptRecoveryBatch({ limit: batchLimit() });
  logInfo("checkout_attempt_recovery.worker.completed", result);
}

main()
  .catch((error) => {
    logError("checkout_attempt_recovery.worker.failed", { error });
    emitOperationalAlert("checkout_attempt_recovery_failed", { error });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
