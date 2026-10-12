import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/layout/auth-shell";
import { buttonClasses } from "@/components/ui/button";
import { reconcileCompletedCheckoutSessionWithSideEffects } from "@/lib/payments/checkout-fulfilment-orchestrator";
import { getStripe, StripeConfigurationError } from "@/lib/stripe";

export const metadata: Metadata = { title: "Checking payment status" };

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

  // Arriving here proves nothing about payment: only the signed webhook does.
  return (
    <AuthShell
      description="Your payment is being confirmed. Tickets appear in My tickets once the payment provider confirms it, usually within a minute."
      title="Checking payment status"
    >
      <div>
        <Link className={buttonClasses()} href="/tickets">
          Go to My tickets
        </Link>
      </div>
    </AuthShell>
  );
}
