import { NextResponse } from "next/server";
import Stripe from "stripe";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logError, logInfo, logWarn } from "@/lib/ops/logger";
import { emitMetric } from "@/lib/ops/metrics";
import {
  findOrderForCheckoutSession,
  runCheckoutReconciliationTransaction
} from "@/lib/payments/checkout-reconciliation";
import { reconcileCompletedCheckoutSessionWithSideEffects } from "@/lib/payments/checkout-fulfilment-orchestrator";
import {
  getStripe,
  getStripeWebhookSecret,
  StripeConfigurationError
} from "@/lib/stripe";
import { expireReservationForOrder } from "@/lib/tickets/reservations";

function reconciliationError(message: string, details: Record<string, unknown>) {
  logError("stripe.webhook.reconciliation_failed", {
    message,
    ...details
  });
}

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

      await runCheckoutReconciliationTransaction(async (tx) => {
        const order = await findOrderForCheckoutSession(session, tx);

        if (!order) {
          reconciliationError("Local order not found for expired Stripe session", {
            stripeSessionId: session.id,
            metadataOrderId: session.metadata?.orderId
          });
          return;
        }

        logInfo("stripe.webhook.received", {
          orderId: order.id,
          stripeSessionId: session.id,
          status: order.status
        });

        if (order.status === "paid") {
          logInfo("stripe.webhook.ignored", {
            orderId: order.id,
            stripeSessionId: session.id
          });
          return;
        }

        if (order.stripeSessionId && order.stripeSessionId !== session.id) {
          reconciliationError("Expired Stripe session id does not match local order", {
            orderId: order.id,
            stripeSessionId: session.id,
            orderStripeSessionId: order.stripeSessionId
          });
          return;
        }

        if (order.status === "failed") {
          logInfo("stripe.webhook.ignored", {
            orderId: order.id,
            stripeSessionId: session.id,
            failureReason: order.failureReason
          });
          return;
        }

        if (order.status === "expired") {
          logInfo("stripe.webhook.ignored", {
            orderId: order.id,
            stripeSessionId: session.id
          });
          return;
        }

        if (order.status !== "pending") {
          reconciliationError("Expired Stripe session order is not pending", {
            orderId: order.id,
            stripeSessionId: session.id,
            status: order.status
          });
          return;
        }

        const now = new Date();

        await tx.order.update({
          where: { id: order.id },
          data: {
            status: "expired",
            stripeSessionId: order.stripeSessionId ?? session.id,
            failureReason: null
          }
        });
        await expireReservationForOrder(
          tx,
          order.id,
          "Stripe Checkout Session expired before payment",
          now
        );

        logInfo("stripe.webhook.received", {
          orderId: order.id,
          stripeSessionId: session.id
        });
      });

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
