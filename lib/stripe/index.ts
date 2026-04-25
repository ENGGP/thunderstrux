import Stripe from "stripe";

export class StripeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeConfigurationError";
  }
}

export function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new StripeConfigurationError("STRIPE_SECRET_KEY missing at runtime");
  }

  return new Stripe(secretKey, {
    apiVersion: "2026-03-25.dahlia"
  });
}

export function getStripeWebhookSecret() {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new StripeConfigurationError("STRIPE_WEBHOOK_SECRET is not configured");
  }

  return webhookSecret;
}

export function getStripeConnectWebhookSecret() {
  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new StripeConfigurationError(
      "STRIPE_CONNECT_WEBHOOK_SECRET is not configured"
    );
  }

  return webhookSecret;
}

export function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
