import Stripe from "stripe";
import { sendTicketDeliveryEmail } from "@/lib/email/ticket-delivery";
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
  const result = await reconcileCompletedCheckoutSession(session, {
    stripeEventId,
    source
  });

  if (result.status !== "fulfilled") {
    return result;
  }

  try {
    await sendTicketDeliveryEmail({
      orderId: result.orderId,
      mode: "automatic"
    });
  } catch (error) {
    console.error("Ticket delivery email failed after checkout reconciliation", {
      orderId: result.orderId,
      stripeSessionId: session.id,
      error
    });
  }

  return result;
}
