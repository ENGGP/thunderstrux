import { prisma } from "@/lib/db";
import { processTicketEmailOutboxBatch } from "@/lib/email/ticket-email-outbox";

async function main() {
  const result = await processTicketEmailOutboxBatch();

  console.log("Ticket email outbox batch processed", result);
}

main()
  .catch((error) => {
    console.error("Ticket email outbox batch failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
