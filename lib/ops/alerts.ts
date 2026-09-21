import { logError } from "@/lib/ops/logger";

export type OperationalAlertName =
  | "paid_but_unfulfilled_compensation_required"
  | "email_outbox_retry_exhausted"
  | "checkout_session_creation_failure"
  | "payment_reconciliation_ambiguous_order"
  | "stripe_webhook_signature_failure"
  | "stale_order_worker_failed"
  | "db_migration_failed"
  | "app_healthcheck_failed";

export type OperationalAlertPayload = {
  orderId: string;
  stripeSessionId: string;
  eventId: string;
  reason: string;
  source: "webhook" | "dev_success_fallback";
} | Record<string, unknown>;

export function emitOperationalAlert(
  event: OperationalAlertName,
  payload: OperationalAlertPayload
) {
  try {
    logError("ops.alert", {
      event,
      ...payload
    });
  } catch {
    // Alerting must never affect payment reconciliation.
  }
}
