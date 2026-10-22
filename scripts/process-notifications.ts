import { prisma } from "@/lib/db";
import { processNotificationBatch } from "@/lib/email/notification-outbox";
import { fanOutEventChanges } from "@/lib/events/event-changes";
import { queueMembershipNotices } from "@/lib/memberships/reminders";
import { logError, logInfo } from "@/lib/ops/logger";
import { cleanUpExpiredTokens } from "@/lib/security/token-cleanup";

// Each run first queues what is due (event change fanout, membership
// reminders and expiry notices, T30), deletes long-expired tokens (T39),
// then sends one bounded batch. A failed
// queueing step is logged and retried next run; it never blocks sending.
async function run() {
  const queued = { eventChanges: 0, membershipNotices: 0 };
  try { queued.eventChanges = await fanOutEventChanges(); }
  catch { logError("notification_outbox.event_changes.failed", { reason: "fanout_failed" }); process.exitCode = 1; }
  try { queued.membershipNotices = await queueMembershipNotices(); }
  catch { logError("notification_outbox.membership_notices.failed", { reason: "queue_failed" }); process.exitCode = 1; }
  logInfo("notification_outbox.scheduled.queued", queued);
  // Housekeeping (T39): expired tokens, a bounded batch per run.
  try { logInfo("security.tokens.cleaned", await cleanUpExpiredTokens()); }
  catch { logError("security.tokens.cleanup_failed", { reason: "cleanup_failed" }); process.exitCode = 1; }
  await processNotificationBatch();
}

run().catch(() => {
  logError("notification_outbox.worker.failed", { reason: "batch_failed" });
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
