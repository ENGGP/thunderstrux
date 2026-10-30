import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logError, logInfo, logWarn } from "@/lib/ops/logger";
import { emitMetric } from "@/lib/ops/metrics";
import { getStripe, getStripeAccountsWebhookSecret, isLiveStripeKey, StripeConfigurationError } from "@/lib/stripe";
import { refreshConnectedAccount } from "@/lib/stripe/connect";

// PAY-023: the Accounts v2 event destination ("Your account" scope). Its events
// are thin: each names an account that changed, which is re-read. Payouts and
// bank-account changes still arrive at the Connect webhook.
const accountEvents = new Set([
  "v2.core.account.closed",
  "v2.core.account[identity].updated",
  "v2.core.account[requirements].updated",
  "v2.core.account[configuration.merchant].updated",
  "v2.core.account[configuration.merchant].capability_status_updated",
  "v2.core.account[configuration.recipient].updated",
  "v2.core.account[configuration.recipient].capability_status_updated"
]);

function signatureFailure(reason: string, error?: unknown, requestBytes?: number) {
  logWarn("stripe_accounts.webhook.signature_failed", { reason, requestBytes, error });
  emitMetric("stripe_webhook_signature_failures_total", 1, { webhook: "stripe_accounts" });
  emitOperationalAlert("stripe_webhook_signature_failure", { reason, webhook: "stripe_accounts" });
  return NextResponse.json({ error: reason === "missing_signature" ? "Missing Stripe signature" : "Invalid Stripe signature" }, { status: 400 });
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return signatureFailure("missing_signature");

  const body = await readWebhookBody(request, "stripe_accounts");
  if ("refused" in body) return body.refused;
  const { rawBody } = body;
  let stripe: Stripe;
  let webhookSecret: string;
  try {
    stripe = getStripe();
    webhookSecret = getStripeAccountsWebhookSecret();
  } catch (error) {
    if (error instanceof StripeConfigurationError) {
      logError("stripe_accounts.webhook.configuration_error", { message: error.message });
      return NextResponse.json({ error: "Stripe accounts webhook is not configured" }, { status: 503 });
    }
    throw error;
  }

  let event: Stripe.V2.Core.EventNotification;
  try {
    event = stripe.parseEventNotification(rawBody, signature, webhookSecret);
  } catch (error) {
    return signatureFailure("invalid_signature", error, rawBody.length);
  }

  logInfo("stripe_accounts.webhook.received", { stripeEventId: event.id, eventType: event.type });

  // A test-mode event reaching a live deployment (or the reverse) is ignored, not applied.
  if (event.livemode !== isLiveStripeKey()) {
    logError("stripe.webhook.mode_mismatch", { stripeEventId: event.id, eventLivemode: event.livemode, webhook: "stripe_accounts" });
    emitOperationalAlert("stripe_webhook_mode_mismatch", { stripeEventId: event.id, webhook: "stripe_accounts" });
    return NextResponse.json({ received: true, ignored: "mode_mismatch" });
  }

  const related = "related_object" in event ? event.related_object : undefined;
  const accountId = related && "id" in related && typeof related.id === "string" ? related.id : undefined;
  if (accountEvents.has(event.type) && accountId) {
    // If Stripe can't answer, the 500 makes it retry.
    const update = await refreshConnectedAccount(accountId);
    if (update.count === 0) logError("stripe_accounts.webhook.ignored", { reason: "stripe_account_not_found", stripeAccountId: accountId });
  }

  return NextResponse.json({ received: true });
}
