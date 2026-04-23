import { NextResponse } from "next/server";
import Stripe from "stripe";
import {
  getStripe,
  getStripeConnectWebhookSecret
} from "@/lib/stripe";
import { persistConnectedAccountStatus } from "@/lib/stripe/connect";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });
  }

  const rawBody = await request.text();
  const stripe = getStripe();
  const webhookSecret = getStripeConnectWebhookSecret();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const update = await persistConnectedAccountStatus(account);

    if (update.count === 0) {
      console.error(`No organisation found for Stripe account ${account.id}`);
    }
  }

  return NextResponse.json({ received: true });
}
