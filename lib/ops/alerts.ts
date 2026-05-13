export type OperationalAlertName =
  | "paid_but_unfulfilled_compensation_required";

export type OperationalAlertPayload = {
  orderId: string;
  stripeSessionId: string;
  eventId: string;
  reason: string;
  source: "webhook" | "dev_success_fallback";
};

export function emitOperationalAlert(
  event: OperationalAlertName,
  payload: OperationalAlertPayload
) {
  try {
    console.error("Operational alert", {
      event,
      ...payload
    });
  } catch {
    // Alerting must never affect payment reconciliation.
  }
}
