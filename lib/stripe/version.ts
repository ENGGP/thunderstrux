import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logWarn } from "@/lib/ops/logger";

// The Stripe API version the app speaks (PAY-006): the one stripe 23 is typed for.
// Hosted webhook endpoints are created on it, and the staging run checks that
// every event the app received was shaped for it.
export const stripeApiVersion = "2026-09-30.endive";

// An endpoint created on another version sends events shaped for it. They are
// still handled, but the endpoint needs replacing on this version; see the
// runbook in Production Operations.
export function warnOnVersionMismatch(event: { id: string; api_version?: string | null }, webhook: string) {
  if (!event.api_version || event.api_version === stripeApiVersion) return;
  logWarn("stripe.webhook.version_mismatch", { stripeEventId: event.id, eventApiVersion: event.api_version, appApiVersion: stripeApiVersion, webhook });
  emitOperationalAlert("stripe_webhook_version_mismatch", { webhook, eventApiVersion: event.api_version, dedupeKey: `stripe_webhook_version_mismatch:${webhook}` });
}
