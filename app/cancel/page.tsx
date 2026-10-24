import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { formatTime } from "@/components/calendar/layout";
import { AuthShell } from "@/components/layout/auth-shell";
import { UnpaidOrderActions } from "@/components/purchases/unpaid-order-actions";
import { buttonClasses } from "@/components/ui/button";
import { getLiveSession } from "@/lib/auth/live-session";
import { guestCookieName, readGuestSession } from "@/lib/guest/guest-access";
import { guestCsrfToken } from "@/lib/guest/guest-csrf";
import { pendingCheckoutState } from "@/lib/purchases/pending-checkout";
import { ticketOrderProjection } from "@/lib/purchases/projection";
import { getTicketPurchaseStatus, mayOpenTicketPurchase } from "@/lib/purchases/ticket-purchases";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payment cancelled", robots: { index: false, follow: false } };

// Where Stripe sends a buyer who leaves without paying. The order is named only
// to the member or guest session that bought it; anyone else sees the generic
// page. While the hold lasts, the buyer can go back to Stripe or cancel (round E1).
export default async function CancelPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const orderId = (await searchParams).order;
  const sessionId = (await cookies()).get(guestCookieName)?.value;
  const [order, live, guest] = orderId
    ? await Promise.all([getTicketPurchaseStatus(orderId), getLiveSession(), readGuestSession(sessionId)])
    : [null, null, null];
  const own = order && (await mayOpenTicketPurchase(order, { userId: live?.user.id, guest })) ? order : null;
  const projection = own ? ticketOrderProjection(own) : null;
  const checkout = own && projection === "processing" ? await pendingCheckoutState({ kind: "ticket", id: own.id }) : null;
  const orderHref = own ? (own.userId ? `/purchases/tickets/${own.id}` : `/guest/orders/${own.id}`) : "/purchases";

  // Paid in another tab after all, or Stripe has the payment: say so rather than "no payment".
  if (own && (checkout?.state === "confirming" || (projection !== "processing" && projection !== "failed" && projection !== "expired"))) {
    return (
      <AuthShell description="Your payment reached Stripe after you left its page." title="Your order went through">
        <div>
          <Link className={buttonClasses()} href={orderHref}>See your order</Link>
        </div>
      </AuthShell>
    );
  }
  if (own && checkout?.state === "waiting") {
    const what = `${own.quantity} ${own.quantity === 1 ? "ticket" : "tickets"}`;
    return (
      <AuthShell
        description={`You left Stripe before paying, so nothing was charged. We're holding your ${what} until ${formatTime(checkout.holdEndsAt, own.event.organisation.timeZone)}.`}
        title="You haven't paid yet"
      >
        <UnpaidOrderActions
          cancelUrl={`/api/purchases/tickets/${own.id}/cancel`}
          guestCsrf={!own.userId && sessionId ? guestCsrfToken(sessionId) : undefined}
          confirmText={`The ${what} you're holding for ${own.event.title} ${own.quantity === 1 ? "goes" : "go"} back on sale.`}
          paymentUrl={checkout.paymentUrl}
          stacked
          title="Cancel this order?"
        />
      </AuthShell>
    );
  }
  return (
    <AuthShell
      description={own ? "Nothing was charged, and the tickets you were holding are back on sale." : "You left the payment page before paying. You can start again from the event."}
      title="No payment taken"
    >
      <div>
        {own ? (
          <Link className={buttonClasses({ variant: "secondary" })} href={`/events/${own.event.id}`}>Back to {own.event.title}</Link>
        ) : (
          <Link className={buttonClasses({ variant: "secondary" })} href="/events">Browse events</Link>
        )}
      </div>
    </AuthShell>
  );
}
