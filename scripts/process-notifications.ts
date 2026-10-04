import { prisma } from "@/lib/db";
import { processNotificationBatch } from "@/lib/email/notification-outbox";
import { logError } from "@/lib/ops/logger";
processNotificationBatch().catch(() => {
  logError("notification_outbox.worker.failed", { reason: "batch_failed" });
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
