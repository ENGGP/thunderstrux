import { reconcileCompletedCheckoutSessionWithSideEffects } from "@/lib/payments/checkout-fulfilment-orchestrator";
import { getStripe, StripeConfigurationError } from "@/lib/stripe";

type SuccessPageProps = {
  searchParams: Promise<{
    session_id?: string;
  }>;
};

async function runDevCheckoutFallback(sessionId: string | undefined) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  if (!sessionId) {
    console.warn(
      "DEV CHECKOUT FALLBACK skipped: success page loaded without session_id. Use Stripe Checkout success_url with {CHECKOUT_SESSION_ID}."
    );
    return;
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    console.warn("DEV CHECKOUT FALLBACK running", {
      stripeSessionId: session.id,
      paymentStatus: session.payment_status,
      orderId: session.metadata?.orderId
    });

    if (session.payment_status !== "paid") {
      console.warn("DEV CHECKOUT FALLBACK skipped unpaid session", {
        stripeSessionId: session.id,
        paymentStatus: session.payment_status
      });
      return;
    }

    await reconcileCompletedCheckoutSessionWithSideEffects(session, {
      source: "dev_success_fallback"
    });
  } catch (error) {
    if (error instanceof StripeConfigurationError) {
      console.warn("DEV CHECKOUT FALLBACK skipped: Stripe is not configured", {
        message: error.message
      });
      return;
    }

    console.error("DEV CHECKOUT FALLBACK failed", {
      sessionId,
      error
    });
  }
}

export default async function SuccessPage({ searchParams }: SuccessPageProps) {
  const { session_id: sessionId } = await searchParams;
  await runDevCheckoutFallback(sessionId);

  return (
    <main className="grid min-h-screen place-items-center bg-neutral-50 px-6">
      <section className="rounded-lg border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-neutral-950">
          Payment successful
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          Your payment is being confirmed.
        </p>
      </section>
    </main>
  );
}
