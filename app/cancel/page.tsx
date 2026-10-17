import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { AuthShell } from "@/components/layout/auth-shell";
import { buttonClasses } from "@/components/ui/button";
import { getLiveSession } from "@/lib/auth/live-session";
import { guestCookieName, readGuestSession } from "@/lib/guest/guest-access";
import { ticketOrderProjection } from "@/lib/purchases/projection";
import { getTicketPurchaseStatus, mayOpenTicketPurchase } from "@/lib/purchases/ticket-purchases";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payment cancelled", robots: { index: false, follow: false } };

// Where Stripe sends a buyer who leaves without paying. The order is named only
// to the member or guest session that bought it; anyone else sees the generic page.
export default async function CancelPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const orderId = (await searchParams).order;
  const [order, live, guest] = orderId
    ? await Promise.all([getTicketPurchaseStatus(orderId), getLiveSession(), cookies().then((jar) => readGuestSession(jar.get(guestCookieName)?.value))])
    : [null, null, null];
  const own = order && (await mayOpenTicketPurchase(order, { userId: live?.user.id, guest })) ? order : null;
  const projection = own ? ticketOrderProjection(own) : null;

  // Paid in another tab after all: say so rather than "no payment".
  if (own && projection !== "processing" && projection !== "failed" && projection !== "expired") {
    return (
      <AuthShell description="This order has gone through since you left Stripe." title="Your order went through">
        <div>
          <Link className={buttonClasses()} href={own.userId ? `/purchases/tickets/${own.id}` : `/guest/orders/${own.id}`}>See your order</Link>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell
      description={own
        ? "You left Stripe before paying, so nothing was charged. The tickets you were holding go back on sale when the hold ends."
        : "No payment was taken."}
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
