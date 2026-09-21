import { NextResponse } from "next/server";
import Stripe from "stripe";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logError, logInfo, logWarn } from "@/lib/ops/logger";
import { emitMetric } from "@/lib/ops/metrics";
import { reconcileExpiredCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import { reconcileCompletedCheckoutSessionWithSideEffects } from "@/lib/payments/checkout-fulfilment-orchestrator";
import {
  getStripe,
  getStripeWebhookSecret,
  StripeConfigurationError
} from "@/lib/stripe";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    logWarn("stripe.webhook.signature_failed", {
      reason: "missing_signature"
    });
    emitMetric("stripe_webhook_signature_failures_total");
    emitOperationalAlert("stripe_webhook_signature_failure", {
      reason: "missing_signature",
      webhook: "payments"
    });
    return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });
  }

  const rawBody = await request.text();
  let stripe: Stripe;
  let webhookSecret: string;

  try {
    stripe = getStripe();
    webhookSecret = getStripeWebhookSecret();
  } catch (error) {
    if (error instanceof StripeConfigurationError) {
      logError("stripe.webhook.configuration_error", {
        message: error.message
      });
      return NextResponse.json(
        { error: "Stripe webhook is not configured" },
        { status: 503 }
      );
    }

    throw error;
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    logInfo("stripe.webhook.received", {
      requestBytes: rawBody.length
    });
  } catch (error) {
    logError("stripe.webhook.signature_failed", {
      requestBytes: rawBody.length,
      reason: "invalid_signature",
      error
    });
    emitMetric("stripe_webhook_signature_failures_total");
    emitOperationalAlert("stripe_webhook_signature_failure", {
      reason: "invalid_signature",
      webhook: "payments"
    });
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  logInfo("stripe.webhook.received", {
    stripeEventId: event.id,
    eventType: event.type
  });

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      logInfo("stripe.webhook.received", {
        stripeEventId: event.id,
        stripeSessionId: session.id,
        paymentStatus: session.payment_status,
        orderId: session.metadata?.orderId
      });

      await reconcileCompletedCheckoutSessionWithSideEffects(session, {
        stripeEventId: event.id,
        source: "webhook"
      });

      return NextResponse.json({ received: true });
    }

    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;

      logInfo("stripe.webhook.received", {
        stripeEventId: event.id,
        stripeSessionId: session.id,
        metadataOrderId: session.metadata?.orderId
      });

      await reconcileExpiredCheckoutSession(session, { stripeEventId: event.id });

      return NextResponse.json({ received: true });
    }

    default:
      logInfo("stripe.webhook.ignored", {
        stripeEventId: event.id,
        eventType: event.type
      });
      return new Response("Ignored", { status: 200 });
  }
}
