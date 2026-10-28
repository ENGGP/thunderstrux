import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/layout/auth-shell";
import { CheckoutShell } from "@/components/layout/checkout-shell";
import { PaymentStatusPoller } from "@/components/purchases/payment-status-poller";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getLiveSession } from "@/lib/auth/live-session";
import { buyerPurchaseBadge, justIssued, ticketOrderProjection } from "@/lib/purchases/projection";
import { getOwnOrderForCheckoutSession } from "@/lib/purchases/ticket-purchases";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Checking payment status", robots: { index: false, follow: false } };

type SuccessPageProps = {
  searchParams: Promise<{
    session_id?: string;
  }>;
};

export default async function SuccessPage({ searchParams }: SuccessPageProps) {
  const { session_id: sessionId } = await searchParams;
  const live = await getLiveSession();
  const order = sessionId && live ? await getOwnOrderForCheckoutSession(live.user.id, sessionId) : null;

  // Arriving here proves nothing about payment: the signed webhook, or the
  // reconciliation sweep asking Stripe (PAY-024), confirms it, in every
  // environment. The page shows the order's real state, only to its buyer.
  if (!order) {
    return (
      <AuthShell
        description="Your payment is being confirmed. Tickets appear in My tickets once the payment provider confirms it, usually within a minute."
        title="Checking payment status"
      >
        <div>
          <Link className={buttonClasses()} href="/purchases">
            Go to Purchases
          </Link>
        </div>
      </AuthShell>
    );
  }

  const projection = ticketOrderProjection(order);
  const badge = buyerPurchaseBadge(order);
  const count = `${order.quantity} ${order.quantity === 1 ? "ticket" : "tickets"}`;
  const purchaseLink = <Link className="font-semibold text-brand underline underline-offset-4" href={`/purchases/tickets/${order.id}`}>See this purchase</Link>;
  const going = projection === "paid" || projection === "free";
  const title = projection === "processing" ? "Confirming your payment" : going ? "You're going" : projection === "failed" || projection === "expired" ? "This checkout didn't complete" : "Your order";

  return (
    <CheckoutShell current={going ? 2 : 1} society={order.event.organisation.name} steps={["Review", "Pay with Stripe", "Tickets"]} title={title}>
      <Card>
        <div className="grid gap-4">
          <div><StatusBadge label={badge.label} status={badge.status} /></div>
          {projection === "processing" ? (
            <>
              <p className="text-ink" role="status">Stripe is telling us about your payment for {order.event.title}. This usually takes under a minute; this page updates by itself.</p>
              <p className="text-sm text-ink-soft">Your {count} {order.quantity === 1 ? "is" : "are"} held while we wait. You won&apos;t be charged twice.</p>
              <PaymentStatusPoller orderId={order.id} />
              <Link className="font-semibold text-brand underline underline-offset-4" href="/purchases">See all purchases</Link>
            </>
          ) : going ? (
            <div className={`grid gap-4 ${justIssued(order.fulfilledAt) ? "issued-stagger" : ""}`}>
              <p className="text-ink">
                {projection === "free" ? "Registration" : "Payment"} confirmed for {count} to {order.event.title}.{" "}
                {/* The email may still be on its way; only say it was sent once the provider took it. */}
                {order.ticketEmailSentAt ? `We've emailed them to ${order.buyerEmailSnapshot}.` : `We're emailing them to ${order.buyerEmailSnapshot}; they're in My tickets now.`}
              </p>
              <div><Link className={buttonClasses({ size: "lg" })} href="/tickets">View my tickets</Link></div>
            </div>
          ) : projection === "failed" || projection === "expired" ? (
            <>
              <p className="text-ink">Nothing was charged.</p>
              <div><Link className={buttonClasses({ variant: "secondary", size: "lg" })} href={`/events/${order.event.id}`}>Back to {order.event.title}</Link></div>
            </>
          ) : (
            <p className="text-ink">{purchaseLink} for where it stands.</p>
          )}
        </div>
      </Card>
    </CheckoutShell>
  );
}
