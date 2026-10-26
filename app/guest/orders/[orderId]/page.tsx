import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { CheckoutShell } from "@/components/layout/checkout-shell";
import { AuthShell } from "@/components/layout/auth-shell";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { GuestClaim } from "@/components/guest/guest-claim";
import { TicketOrderNotice } from "@/components/purchases/ticket-order-notice";
import { UnpaidOrderNotice } from "@/components/purchases/unpaid-order-notice";
import { ReleaseRegistration } from "@/components/purchases/release-registration";
import { guestCsrfToken } from "@/lib/guest/guest-csrf";
import { cancelledByBuyer, pendingCheckoutState } from "@/lib/purchases/pending-checkout";
import { getLiveSession } from "@/lib/auth/live-session";
import { canOpenGuestOrder, guestCookieName, readGuestSession } from "@/lib/guest/guest-access";
import { formatDateRange, formatMoney, ticketReference } from "@/lib/format";
import { getGuestOrder } from "@/lib/orders/member-tickets";
import { purchasedTicketTypeLabel, ticketOrderProjection } from "@/lib/purchases/projection";
import { zoneCity } from "@/lib/zoned-time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your order", referrer: "no-referrer", robots: { index: false, follow: false } };

// Opens only with the guest session that bought the order or that its emailed
// link started. Every other case, including a real order id without the
// session, shows the same page, so an order id alone reveals nothing.
export default async function GuestOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const sessionId = (await cookies()).get(guestCookieName)?.value;
  const [session, live] = await Promise.all([readGuestSession(sessionId), getLiveSession()]);
  const order = session && (await canOpenGuestOrder(session, orderId)) ? await getGuestOrder(orderId) : null;

  if (!order || !session) {
    return (
      <AuthShell title="Open your order from your email">
        <Card>
          <div className="grid gap-4">
            <p className="text-ink-soft">Guest orders open only from the link we emailed you. If it has stopped working, we can send a new one.</p>
            <Link className={buttonClasses({ size: "lg" })} href="/guest/recover">Find your purchase</Link>
          </div>
        </Card>
      </AuthShell>
    );
  }

  const { event } = order;
  const { organisation } = event;
  const count = order.tickets.length;
  // Only an order whose tickets still admit someone shows them: a refunded,
  // disputed or cancelled one (all still status paid) says why instead (T44a).
  const projection = ticketOrderProjection(order);
  const going = projection === "paid" || projection === "free" || (projection === "review" && !order.requiresCompensationReview);
  // A refunded, disputed or cancelled order went through checkout; only an unpaid one is still at review.
  const unfinished = projection === "processing" || projection === "failed" || projection === "expired";
  const ticketName = purchasedTicketTypeLabel(order.purchasedTicketTypeName, order.ticketType.name);
  // An unpaid order asks Stripe where it stands (round E1).
  const [checkout, cancelled] = await Promise.all([
    projection === "processing" ? pendingCheckoutState({ kind: "ticket", id: order.id }) : null,
    projection === "expired" ? cancelledByBuyer({ kind: "ticket", id: order.id }) : false
  ]);

  return (
    <CheckoutShell current={unfinished ? 1 : 2} society={organisation.name} steps={["Your email", "Review", "Tickets"]} title={going ? `You're going to ${event.title}` : "Your order"}>
      <Card>
        <div className="grid gap-4">
          {going ? <StatusBadge status={order.paymentKind === "free" ? "free" : "paid"} /> : null}
          <TicketOrderNotice cancelled={cancelled} order={order} processing={checkout ? (
            <UnpaidOrderNotice
              backHref={`/events/${event.id}`}
              cancelUrl={`/api/purchases/tickets/${order.id}/cancel`}
              checkout={checkout}
              confirming={
                <Notice role="status" title="Confirming your payment">
                  <p>Stripe has your payment and is telling us about it. This usually takes under a minute. <Link className="font-semibold text-brand underline underline-offset-4" href={`/guest/orders/${order.id}`}>Refresh</Link> to check again.</p>
                </Notice>
              }
              guestCsrf={sessionId ? guestCsrfToken(sessionId) : undefined}
              held={{ what: `${order.quantity} ${order.quantity === 1 ? "ticket" : "tickets"}`, many: order.quantity > 1, event: event.title }}
              stacked
              timeZone={organisation.timeZone}
            />
          ) : null} />
          <p className="text-ink-soft [overflow-wrap:anywhere]">
            {formatDateRange(event.startTime, event.endTime, organisation.timeZone)}, {zoneCity(organisation.timeZone)} · {event.location}
          </p>
          {going ? (
            <section aria-label="Your tickets" className="grid gap-2 rounded-card border border-line p-4">
              <h2 className="font-semibold text-ink">Your tickets</h2>
              <ul className="grid gap-1.5">
                {order.tickets.map((ticket) => (
                  <li className="flex justify-between gap-3 text-ink" key={ticket.id}>
                    <span>{ticketName}</span>
                    <span className="font-mono text-sm text-ink-soft" title={ticket.id}>Ticket {ticketReference(ticket.id)} · {ticket.issueSequence} of {order.quantity}</span>
                  </li>
                ))}
              </ul>
              <p className="flex justify-between border-t border-line pt-2 font-semibold text-ink">
                <span>{order.paymentKind === "free" ? "Free" : "Paid"}</span>
                <span className="tabular-nums">{order.paymentKind === "free" ? "Free" : formatMoney(order.totalAmount)}</span>
              </p>
              <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">Sent to {order.buyerEmailSnapshot}</p>
            </section>
          ) : null}
          {going ? <p className="text-sm text-ink-soft">At the door, give your name or show the ticket reference from your email.</p> : null}
          {/* A free registration can be released until the event starts (EVT-005). */}
          {projection === "free" && count > 0 && event.startTime > new Date() && !event.cancelledAt ? (
            <ReleaseRegistration event={event.title} guestCsrf={sessionId ? guestCsrfToken(sessionId) : undefined} orderId={order.id} ticketCount={count} />
          ) : null}
          {organisation.supportEmail || organisation.refundPolicy ? (
            <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm">
              {organisation.supportEmail ? <><dt className="text-ink-soft">Questions</dt><dd className="[overflow-wrap:anywhere]"><a className="text-brand underline underline-offset-4" href={`mailto:${organisation.supportEmail}`}>{organisation.supportEmail}</a></dd></> : null}
              {organisation.refundPolicy ? <><dt className="text-ink-soft">Refunds</dt><dd className="text-ink-soft">{organisation.refundPolicy}</dd></> : null}
            </dl>
          ) : null}
          {going ? <AccountClaim live={live} order={order} guestEmail={session.email} summary={`${event.title}, ${count} ${count === 1 ? "ticket" : "tickets"}`} /> : null}
          <p className="text-sm text-ink-muted">Lost this page? <Link className="text-brand underline underline-offset-4" href="/guest/recover">Find your purchase</Link> sends a fresh link for each purchase.</p>
        </div>
      </Card>
    </CheckoutShell>
  );
}

type LiveSession = Awaited<ReturnType<typeof getLiveSession>>;

// Where this guest order stands against the signed-in account, if any.
function AccountClaim({ live, order, guestEmail, summary }: {
  live: LiveSession;
  order: { id: string; userId: string | null; status: string; buyerEmailSnapshot: string | null };
  guestEmail: string;
  summary: string;
}) {
  const member = live?.user.accountRole === "member" ? live.user : null;
  const link = "font-semibold text-brand underline underline-offset-4";
  if (order.userId) {
    return order.userId === member?.id ? (
      <Notice title="This order is in your account" tone="success">
        <p>Find these tickets in <Link className={link} href="/tickets">My tickets</Link>.</p>
      </Notice>
    ) : (
      <Notice title="Already in an account">
        <p>This order has already been added to an account. Sign in with that account to see it in My tickets.</p>
      </Notice>
    );
  }
  if (order.status !== "paid") return null;
  if (!member) {
    return (
      <div className="grid gap-1 rounded-card bg-surface-subtle p-4">
        <p className="font-semibold text-ink">Keep your tickets in one place</p>
        <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">Sign in or create an account with {guestEmail}, then come back here to add this order to it.</p>
        <Link className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4" href={`/login?callbackUrl=${encodeURIComponent(`/guest/orders/${order.id}`)}`}>Sign in or create an account</Link>
      </div>
    );
  }
  if (!member.emailVerifiedAt) {
    return (
      <Notice title="Verify your email to add this order">
        <p><Link className={link} href={`/verify-email?callbackUrl=${encodeURIComponent(`/guest/orders/${order.id}`)}`}>Verify email</Link></p>
      </Notice>
    );
  }
  if (member.email !== guestEmail) {
    return (
      <Notice title="This order uses a different email">
        <p className="[overflow-wrap:anywhere]">It was bought with {guestEmail}, and you&apos;re signed in as {member.email}. Only an account with the same verified email can add it.</p>
      </Notice>
    );
  }
  return <GuestClaim email={guestEmail} orderId={order.id} summary={summary} />;
}
