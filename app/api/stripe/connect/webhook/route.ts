import { NextResponse } from "next/server";
import Stripe from "stripe";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logError, logInfo, logWarn } from "@/lib/ops/logger";
import { emitMetric } from "@/lib/ops/metrics";
import {
  getStripe,
  getStripeConnectWebhookSecret,
  isLiveStripeKey,
  StripeConfigurationError
} from "@/lib/stripe";
import { reconcilePayoutEvent } from "@/lib/payouts/payouts";
import { refreshConnectedAccount } from "@/lib/stripe/connect";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    logWarn("stripe_connect.webhook.signature_failed", {
      reason: "missing_signature"
    });
    emitMetric("stripe_webhook_signature_failures_total", 1, {
      webhook: "stripe_connect"
    });
    emitOperationalAlert("stripe_webhook_signature_failure", {
      reason: "missing_signature",
      webhook: "stripe_connect"
    });
    return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });
  }

  const rawBody = await request.text();
  let stripe: Stripe;
  let webhookSecret: string;

  try {
    stripe = getStripe();
    webhookSecret = getStripeConnectWebhookSecret();
  } catch (error) {
    if (error instanceof StripeConfigurationError) {
      logError("stripe_connect.webhook.configuration_error", {
        message: error.message
      });
      return NextResponse.json(
        { error: "Stripe Connect webhook is not configured" },
        { status: 503 }
      );
    }

    throw error;
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    logError("stripe_connect.webhook.signature_failed", {
      requestBytes: rawBody.length,
      reason: "invalid_signature",
      error
    });
    emitMetric("stripe_webhook_signature_failures_total", 1, {
      webhook: "stripe_connect"
    });
    emitOperationalAlert("stripe_webhook_signature_failure", {
      reason: "invalid_signature",
      webhook: "stripe_connect"
    });
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  logInfo("stripe_connect.webhook.received", {
    stripeEventId: event.id,
    eventType: event.type
  });

  // A test-mode event reaching a live deployment (or the reverse) is ignored, not applied.
  if (event.livemode !== isLiveStripeKey()) {
    logError("stripe.webhook.mode_mismatch", { stripeEventId: event.id, eventLivemode: event.livemode, webhook: "stripe_connect" });
    emitOperationalAlert("stripe_webhook_mode_mismatch", { stripeEventId: event.id, webhook: "stripe_connect" });
    return NextResponse.json({ received: true, ignored: "mode_mismatch" });
  }

  if (event.type === "account.updated") {
    const accountId = (event.data.object as Stripe.Account).id;
    // If Stripe can't answer, the 500 makes it retry.
    const update = await refreshConnectedAccount(accountId);

    if (update.count === 0) {
      logError("stripe_connect.webhook.ignored", {
        reason: "stripe_account_not_found",
        stripeAccountId: accountId
      });
    } else {
      logInfo("stripe_connect.webhook.received", {
        stripeAccountId: accountId,
        updatedOrganisations: update.count
      });
    }
  }

  // PAY-005: payouts from a society's balance to its bank.
  if (event.type === "payout.paid" || event.type === "payout.failed" || event.type === "payout.canceled" || event.type === "payout.updated") {
    await reconcilePayoutEvent(event);
  }

  return NextResponse.json({ received: true });
}
