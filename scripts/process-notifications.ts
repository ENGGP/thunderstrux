import { processNotificationBatch } from "@/lib/email/notification-outbox";
import { fanOutEventChanges } from "@/lib/events/event-changes";
import { queueMembershipNotices } from "@/lib/memberships/reminders";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logError, logInfo } from "@/lib/ops/logger";
import { runWorker } from "@/lib/ops/worker";
import { cleanUpExpiredTokens } from "@/lib/security/token-cleanup";

// Each run first queues what is due (event change fanout, membership
// reminders and expiry notices, T30), deletes long-expired tokens and finished
// notifications (T39, SEC-043), then sends batches until its budget is spent.
// A failed step alerts and is retried next run; it never blocks sending.
// The alert carries no error: those can hold notice content.
function stepFailed(step: string) {
  emitOperationalAlert("notification_step_failed", { step, dedupeKey: `notification_step_failed:${step}` });
  process.exitCode = 1;
}

async function run() {
  const queued = { eventChanges: 0, membershipNotices: 0 };
  try { queued.eventChanges = await fanOutEventChanges(); }
  catch { logError("notification_outbox.event_changes.failed", { reason: "fanout_failed" }); stepFailed("event_changes"); }
  try { queued.membershipNotices = await queueMembershipNotices(); }
  catch { logError("notification_outbox.membership_notices.failed", { reason: "queue_failed" }); stepFailed("membership_notices"); }
  logInfo("notification_outbox.scheduled.queued", queued);
  // Housekeeping (T39): a bounded batch per run.
  try { logInfo("security.tokens.cleaned", await cleanUpExpiredTokens()); }
  catch { logError("security.tokens.cleanup_failed", { reason: "cleanup_failed" }); stepFailed("token_cleanup"); }
  // Its errors can carry notice content, so only a generic failure leaves this process.
  await processNotificationBatch().catch(() => { throw new Error("Notification batch failed"); });
}

// T42: one run at a time, pausable, with a timeout and an alert on failure.
void runWorker("notifications", run);
