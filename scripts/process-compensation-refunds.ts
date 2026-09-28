import { prisma } from "@/lib/db";
import { logError, logInfo } from "@/lib/ops/logger";
import { processCompensationRefundBatch } from "@/lib/payments/compensation-refunds";

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
  const result = await processCompensationRefundBatch(batchLimit());
  logInfo("compensation_refund.worker.completed", result);
}

main()
  .catch((error) => {
    logError("compensation_refund.worker.failed", { error });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
