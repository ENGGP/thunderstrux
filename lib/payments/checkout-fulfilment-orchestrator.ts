import Stripe from "stripe";
import {
  CheckoutReconciliationResult,
  reconcileCompletedCheckoutSession
} from "@/lib/payments/checkout-reconciliation";
import { getStripe } from "@/lib/stripe";

// Where the money went, read from Stripe before any lock: the Session itself
// does not say. A paid Session without a PaymentIntent has no verifiable destination.
async function paymentDestination(session: Stripe.Checkout.Session) {
  const intent = session.payment_intent;
  if (!intent) return null;
  const paymentIntent = typeof intent === "string" ? await getStripe().paymentIntents.retrieve(intent) : intent;
  const destination = paymentIntent.transfer_data?.destination;
  return typeof destination === "string" ? destination : destination?.id ?? null;
}

// The only entry for ticket fulfilment (signed webhook and the reconciliation
// sweep, through lib/payments/checkout-settlement.ts): it always supplies the
// verified destination.
export async function reconcileCompletedCheckoutSessionWithSideEffects(
  session: Stripe.Checkout.Session,
  {
    stripeEventId,
    source = "webhook"
  }: {
    stripeEventId?: string;
    source?: "webhook" | "reconciliation_sweep";
  } = {}
): Promise<CheckoutReconciliationResult> {
  return reconcileCompletedCheckoutSession(session, {
    stripeEventId,
    source,
    destination: session.payment_status === "paid" ? await paymentDestination(session) : null
  });
}
