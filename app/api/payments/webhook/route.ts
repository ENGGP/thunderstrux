import { NextResponse } from "next/server";
import Stripe from "stripe";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logError, logInfo, logWarn } from "@/lib/ops/logger";
import { emitMetric } from "@/lib/ops/metrics";
import { warnOnVersionMismatch } from "@/lib/stripe/version";
import { settleCheckoutSession } from "@/lib/payments/checkout-settlement";
import { reconcileRefundEvent } from "@/lib/payments/compensation-refunds";
import { reconcileEarlyFraudWarning } from "@/lib/payments/fraud-warnings";
import { reconcileOrderRefundEvent } from "@/lib/payments/order-refunds";
import { reconcileDisputeEvent, reconcileExternalRefundEvent } from "@/lib/payments/purchase-disputes";
import { reconcileCommerceDisputeEvent, reconcileCommerceExternalRefundEvent } from "@/lib/commerce/payment-recovery";
import {
  getStripe,
  isLiveStripeKey,
  getStripeWebhookSecret,
  StripeConfigurationError
} from "@/lib/stripe";
import { readWebhookBody } from "@/lib/stripe/webhook-body";

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

  const body = await readWebhookBody(request, "payments");
  if (body.refused) return body.refused;
  const { rawBody } = body;
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
    eventType: event.type,
    apiVersion: event.api_version
  });
  warnOnVersionMismatch(event, "payments");

  // A test-mode event reaching a live deployment (or the reverse) is ignored, not applied.
  if (event.livemode !== isLiveStripeKey()) {
    logError("stripe.webhook.mode_mismatch", { stripeEventId: event.id, eventLivemode: event.livemode, webhook: "payments" });
    emitOperationalAlert("stripe_webhook_mode_mismatch", { stripeEventId: event.id, webhook: "payments" });
    return NextResponse.json({ received: true, ignored: "mode_mismatch" });
  }

  // Checkout events go through the one settlement path the reconciliation sweep
  // also uses (PAY-024); it routes tickets, memberships and merchandise. A delayed
  // payment method settles on async_payment_succeeded, or fails as an expiry (PAY-030).
  const settles = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];
  if (settles.includes(event.type) || event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object as Stripe.Checkout.Session;
    logInfo("stripe.webhook.received", {
      stripeEventId: event.id,
      stripeSessionId: session.id,
      paymentStatus: session.payment_status,
      metadataOrderId: session.metadata?.orderId ?? session.metadata?.commerceOrderId
    });
    await settleCheckoutSession(session, { completed: settles.includes(event.type), stripeEventId: event.id, source: "webhook" });
    return NextResponse.json({ received: true });
  }

  switch (event.type) {
    case "refund.created":
    case "refund.updated":
    case "refund.failed": {
      // Thunderstrux refunds name their request or compensation job; anything
      // else was made outside Thunderstrux, for example in the Stripe dashboard.
      const refund = event.data.object as { metadata?: Record<string, string> | null };
      if (refund.metadata?.refundRequestId) await reconcileOrderRefundEvent(event);
      else if (refund.metadata?.compensationRefundJobId) await reconcileRefundEvent(event);
      else if (!(await reconcileCommerceExternalRefundEvent(event))) await reconcileExternalRefundEvent(event);
      return NextResponse.json({ received: true });
    }

    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed": {
      // A membership or merchandise payment's dispute (PAY-003), else a ticket order's.
      if (!(await reconcileCommerceDisputeEvent(event))) await reconcileDisputeEvent(event);
      return NextResponse.json({ received: true });
    }

    case "radar.early_fraud_warning.created": {
      await reconcileEarlyFraudWarning(event);
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
