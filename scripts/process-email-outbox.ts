import { prisma } from "@/lib/db";
import { processTicketEmailOutboxBatch } from "@/lib/email/ticket-email-outbox";
import { logError, logInfo } from "@/lib/ops/logger";

async function main() {
  const result = await processTicketEmailOutboxBatch();

  logInfo("email_outbox.worker.completed", result);
}

main()
  .catch((error) => {
    logError("email_outbox.worker.failed", { error });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
