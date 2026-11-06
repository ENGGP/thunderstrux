import { logError, logWarn, redactLogContext } from "@/lib/ops/logger";

export type OperationalAlertName =
  | "paid_but_unfulfilled_compensation_required"
  | "email_outbox_retry_exhausted"
  | "notification_outbox_retry_exhausted"
  // A step of the notification job failed, so notices weren't queued or old rows weren't deleted.
  | "notification_step_failed"
  | "checkout_session_creation_failure"
  | "payment_reconciliation_ambiguous_order"
  | "stripe_webhook_signature_failure"
  | "stripe_webhook_body_too_large"
  | "stripe_webhook_mode_mismatch"
  | "stripe_webhook_version_mismatch"
  // PAY-024: the sweep found a payment Stripe completed that no webhook delivered,
  // or couldn't ask Stripe before expiring a pending order.
  | "stripe_webhook_missed"
  | "checkout_reconciliation_unavailable"
  // PAY-029: applying a Session the sweep found failed here (a bug or database error), not at Stripe.
  | "checkout_settlement_failed"
  | "stale_order_worker_failed"
  | "checkout_attempt_recovery_failed"
  | "checkout_attempt_recovery_abandoned"
  | "order_refund_unresolved"
  // PAY-025, PAY-026: a refund Thunderstrux sent failed, or came back from the
  // bank after succeeding; a compensation refund needs a person.
  | "refund_failed"
  | "compensation_refund_needs_review"
  // PAY-027: a refund made in Stripe that didn't take the money back from the society.
  | "outside_refund_not_reversed"
  | "purchase_dispute_opened"
  | "purchase_dispute_unmatched"
  // PAY-073 to PAY-075: a dispute moved in a way only a person can settle: lost for part of a
  // payment, won after its loss on a used order, lost after a restore, or prevented without a block.
  | "purchase_dispute_needs_review"
  // A dispute's draft answer couldn't be staged in Stripe, or its due date is close.
  | "dispute_evidence_not_staged"
  | "purchase_dispute_evidence_due"
  // A card issuer's early fraud warning: refunded automatically, or why not.
  | "early_fraud_warning"
  | "dispute_reversal_unresolved"
  // PAY-088: a sale still held (an open dispute, a review, a cancelled event's buyer) reaches Stripe's hold limit within a week.
  | "dispute_hold_ending"
  // PAY-096: Stripe reported a new payout bank account or default; payouts wait 72 hours.
  | "payout_destination_changed"
  | "society_payout_failed"
  // PAY-028: a payout the payout worker didn't make (an instant payout, or a changed schedule).
  | "society_payout_unexpected"
  // PAY-034: Stripe answers that this platform can no longer reach a society's account.
  | "society_account_unreachable"
  // Stripe paused a society's card payments; a cancelled event had sale money already released.
  | "society_charges_paused"
  | "event_cancelled_after_release"
  | "commerce_webhook_identity_mismatch"
  // PAY-010: a paid ticket Session that isn't the one bound to its order.
  | "ticket_webhook_identity_mismatch"
  // Worker contracts (T42).
  | "worker_failed"
  | "worker_timed_out"
  | "worker_stale"
  | "queue_backlog_high"
  | "queue_processing_stuck"
  // T54: an operator verified for the admin portal (a sign-in you didn't make shows at
  // once), and an operator granted, changed or revoked.
  | "platform_operator_verified"
  | "platform_operator_changed"
  // T55: every change an operator makes in the portal.
  | "platform_admin_action";

export type OperationalAlertPayload = {
  orderId: string;
  stripeSessionId: string;
  eventId: string;
  reason: string;
  source: "webhook" | "reconciliation_sweep";
} | Record<string, unknown>;

const ALERT_DELIVERY_TIMEOUT_MS = 3_000;
const pendingDeliveries = new Set<Promise<void>>();

// Anyone can send an unsigned webhook, so that alert reaches the receiver at most
// every five minutes per process, carrying how many were held back; the log still
// records each one (SEC-020).
const ALERT_COOLDOWN_MS = 5 * 60_000;
// #40: a broken settlement fails on every sweep, so its alert is cooled too.
const cooledAlerts = new Set<OperationalAlertName>(["stripe_webhook_signature_failure", "stripe_webhook_body_too_large", "checkout_settlement_failed"]);
const cooldowns = new Map<OperationalAlertName, { until: number; suppressed: number }>();

// T54: the admin portal path of the record an alert names (ids only, which the
// alert already carries), so the receiver links straight to it.
export function adminPathFor(details: Record<string, unknown>) {
  const id = (key: string) => (typeof details[key] === "string" && details[key] ? details[key] as string : null);
  const order = id("orderId") ?? id("commerceOrderId");
  if (order) return `/admin/orders/${encodeURIComponent(order)}`;
  const organisation = id("organisationId");
  if (organisation) return `/admin/societies/${encodeURIComponent(organisation)}`;
  const user = id("userId");
  return user ? `/admin/users/${encodeURIComponent(user)}` : null;
}

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
  // #31, SEC-060: an error's message can carry buyer data, so a top-level Error leaves as its name only.
  const named = Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, value instanceof Error ? value.name : value]));
  const details: Record<string, unknown> = { ...redactLogContext(named), ...(suppressed ? { suppressed } : {}) };
  const adminPath = adminPathFor(details);
  const body = JSON.stringify({
    event,
    environment: process.env.NODE_ENV ?? "development",
    timestamp: new Date().toISOString(),
    dedupeKey: typeof details.dedupeKey === "string" ? details.dedupeKey : event,
    ...(adminPath ? { adminPath } : {}),
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
