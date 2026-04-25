import { NextResponse } from "next/server";
import Stripe from "stripe";
import {
  getStripe,
  getStripeConnectWebhookSecret,
  StripeConfigurationError
} from "@/lib/stripe";
import { persistConnectedAccountStatus } from "@/lib/stripe/connect";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
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
      console.error("Stripe Connect webhook configuration error", {
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
    console.error(error);
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  console.info("Stripe Connect webhook processing", {
    stripeEventId: event.id,
    eventType: event.type
  });

  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const update = await persistConnectedAccountStatus(account);

    if (update.count === 0) {
      console.error(`No organisation found for Stripe account ${account.id}`);
    } else {
      console.info("Stripe Connect account status persisted from webhook", {
        stripeAccountId: account.id,
        updatedOrganisations: update.count
      });
    }
  }

  return NextResponse.json({ received: true });
}
