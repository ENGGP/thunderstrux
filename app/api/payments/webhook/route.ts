import { NextResponse } from "next/server";
import Stripe from "stripe";
import {
  findOrderForCheckoutSession,
  reconcileCompletedCheckoutSession,
  runCheckoutReconciliationTransaction
} from "@/lib/payments/checkout-reconciliation";
import {
  getStripe,
  getStripeWebhookSecret,
  StripeConfigurationError
} from "@/lib/stripe";
import { expireReservationForOrder } from "@/lib/tickets/reservations";

function reconciliationError(message: string, details: Record<string, unknown>) {
  console.error("Stripe checkout reconciliation failed", {
    message,
    ...details
  });
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    console.warn("Stripe checkout webhook missing signature header");
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
      console.error("Stripe checkout webhook configuration error", {
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
    console.info("Stripe checkout webhook signature verified", {
      rawBodyLength: rawBody.length
    });
  } catch (error) {
    console.error("WEBHOOK ERROR:", error);
    console.error("Stripe checkout webhook signature verification failed", {
      rawBodyLength: rawBody.length,
      message: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  console.info("Stripe checkout webhook processing", {
    stripeEventId: event.id,
    eventType: event.type
  });

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      console.info("Stripe checkout webhook received", {
        stripeEventId: event.id,
        stripeSessionId: session.id,
        paymentStatus: session.payment_status,
        orderId: session.metadata?.orderId
      });

      await reconcileCompletedCheckoutSession(session, {
        stripeEventId: event.id,
        source: "webhook"
      });

      return NextResponse.json({ received: true });
    }

    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;

      console.info("Stripe checkout expired webhook received", {
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

        console.info("Stripe checkout expired order matched", {
          orderId: order.id,
          stripeSessionId: session.id,
          status: order.status
        });

        if (order.status === "paid") {
          console.info("Stripe checkout expired ignored for paid order", {
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
          console.info("Stripe checkout expired ignored for failed order", {
            orderId: order.id,
            stripeSessionId: session.id,
            failureReason: order.failureReason
          });
          return;
        }

        if (order.status === "expired") {
          console.info("Stripe checkout expired ignored for expired order", {
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

        console.info("Stripe checkout expired order marked expired", {
          orderId: order.id,
          stripeSessionId: session.id
        });
      });

      return NextResponse.json({ received: true });
    }

    default:
      console.info("Stripe checkout webhook ignored event", {
        stripeEventId: event.id,
        eventType: event.type
      });
      return new Response("Ignored", { status: 200 });
  }
}
