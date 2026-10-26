import { logError, logWarn, redactLogContext } from "@/lib/ops/logger";

export type OperationalAlertName =
  | "paid_but_unfulfilled_compensation_required"
  | "email_outbox_retry_exhausted"
  | "notification_outbox_retry_exhausted"
  | "checkout_session_creation_failure"
  | "payment_reconciliation_ambiguous_order"
  | "stripe_webhook_signature_failure"
  | "stripe_webhook_mode_mismatch"
  | "stripe_webhook_version_mismatch"
  | "stale_order_worker_failed"
  | "checkout_attempt_recovery_failed"
  | "checkout_attempt_recovery_abandoned"
  | "order_refund_unresolved"
  | "purchase_dispute_opened"
  | "purchase_dispute_unmatched"
  | "dispute_reversal_unresolved"
  | "society_payout_failed"
  | "commerce_webhook_identity_mismatch"
  // PAY-010: a paid ticket Session that isn't the one bound to its order.
  | "ticket_webhook_identity_mismatch"
  | "db_migration_failed"
  | "app_healthcheck_failed"
  // Worker contracts (T42).
  | "worker_failed"
  | "worker_timed_out"
  | "worker_stale"
  | "queue_backlog_high"
  | "queue_processing_stuck";

export type OperationalAlertPayload = {
  orderId: string;
  stripeSessionId: string;
  eventId: string;
  reason: string;
  source: "webhook" | "dev_success_fallback";
} | Record<string, unknown>;

const ALERT_DELIVERY_TIMEOUT_MS = 3_000;
const pendingDeliveries = new Set<Promise<void>>();

// Anyone can send an unsigned webhook, so that alert reaches the receiver at most
// every five minutes per process, carrying how many were held back; the log still
// records each one (SEC-020).
const ALERT_COOLDOWN_MS = 5 * 60_000;
const cooledAlerts = new Set<OperationalAlertName>(["stripe_webhook_signature_failure"]);
const cooldowns = new Map<OperationalAlertName, { until: number; suppressed: number }>();

// T42: with ALERT_WEBHOOK_URL set, each alert is also POSTed there as JSON
// (redacted like the logs). Delivery is best effort: a slow or failing
// receiver is logged and never delays or fails the caller.
function deliverAlert(event: OperationalAlertName, payload: OperationalAlertPayload) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  let suppressed = 0;
  if (cooledAlerts.has(event)) {
    const now = Date.now();
    const state = cooldowns.get(event);
    if (state && now < state.until) { state.suppressed += 1; return; }
    suppressed = state?.suppressed ?? 0;
    cooldowns.set(event, { until: now + ALERT_COOLDOWN_MS, suppressed: 0 });
  }
  const details: Record<string, unknown> = { ...redactLogContext(payload), ...(suppressed ? { suppressed } : {}) };
  const body = JSON.stringify({
    event,
    environment: process.env.NODE_ENV ?? "development",
    timestamp: new Date().toISOString(),
    dedupeKey: typeof details.dedupeKey === "string" ? details.dedupeKey : event,
    details
  });
  const delivery: Promise<void> = fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(ALERT_DELIVERY_TIMEOUT_MS) })
    .then((response) => { if (!response.ok) logWarn("ops.alert.delivery_failed", { alert: event, status: response.status }); })
    .catch(() => { logWarn("ops.alert.delivery_failed", { alert: event, reason: "unreachable" }); })
    .finally(() => { pendingDeliveries.delete(delivery); });
  pendingDeliveries.add(delivery);
}

export function emitOperationalAlert(
  event: OperationalAlertName,
  payload: OperationalAlertPayload
) {
  try {
    logError("ops.alert", {
      event,
      ...payload
    });
    deliverAlert(event, payload);
  } catch {
    // Alerting must never affect payment reconciliation.
  }
}

// Short-lived commands await this before exiting so their alerts arrive.
export async function flushOperationalAlerts() {
  await Promise.allSettled([...pendingDeliveries]);
}
