import { NextResponse } from "next/server";
import Stripe from "stripe";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logError, logInfo, logWarn } from "@/lib/ops/logger";
import { emitMetric } from "@/lib/ops/metrics";
import {
  getStripe,
  getStripeConnectWebhookSecret,
  StripeConfigurationError
} from "@/lib/stripe";
import { persistConnectedAccountStatus } from "@/lib/stripe/connect";

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

  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const update = await persistConnectedAccountStatus(account);

    if (update.count === 0) {
      logError("stripe_connect.webhook.ignored", {
        reason: "stripe_account_not_found",
        stripeAccountId: account.id
      });
    } else {
      logInfo("stripe_connect.webhook.received", {
        stripeAccountId: account.id,
        updatedOrganisations: update.count
      });
    }
  }

  return NextResponse.json({ received: true });
}
