import Stripe from "stripe";
import {
  CheckoutReconciliationResult,
  reconcileCompletedCheckoutSession
} from "@/lib/payments/checkout-reconciliation";

export async function reconcileCompletedCheckoutSessionWithSideEffects(
  session: Stripe.Checkout.Session,
  {
    stripeEventId,
    source = "webhook"
  }: {
    stripeEventId?: string;
    source?: "webhook" | "dev_success_fallback";
  } = {}
): Promise<CheckoutReconciliationResult> {
  return reconcileCompletedCheckoutSession(session, {
    stripeEventId,
    source
  });
}
