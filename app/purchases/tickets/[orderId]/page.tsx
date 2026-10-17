import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PersonalShell } from "@/components/layout/personal-shell";
import { PaymentStatusPoller } from "@/components/purchases/payment-status-poller";
import { ticketReference, ticketState } from "@/components/tickets/ticket-face";
import { AuditTimeline } from "@/components/ui/audit-timeline";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/auth/access";
import { formatDate, formatDateRange, formatMoney, formatPrice } from "@/lib/format";
import { buyerPurchaseBadge, purchasedTicketTypeLabel, ticketOrderProjection } from "@/lib/purchases/projection";
import { getOwnTicketPurchase } from "@/lib/purchases/ticket-purchases";
import { zoneCity } from "@/lib/zoned-time";

export const metadata: Metadata = { title: "Purchase", robots: { index: false, follow: false } };

type Purchase = NonNullable<Awaited<ReturnType<typeof getOwnTicketPurchase>>>;

// What the buyer needs to know about where this order stands.
function StatusNotice({ order }: { order: Purchase }) {
  const projection = ticketOrderProjection(order);
  const society = order.event.organisation.name;
  const refund = order.refundRequests[0];
  if (projection === "processing") {
    return (
      <Notice role="status" title="Confirming your payment">
        <p>Stripe is telling us about your payment. This usually takes under a minute; this page updates by itself.</p>
        <PaymentStatusPoller orderId={order.id} />
      </Notice>
    );
  }
  if (projection === "failed" || projection === "expired") {
    return <Notice title="This checkout didn't complete"><p>Nothing was charged. <Link className="font-semibold text-brand underline underline-offset-4" href={`/events/${order.event.id}`}>Back to the event</Link></p></Notice>;
  }
  if (projection === "refunded") {
    return (
      <Notice title="Refunded">
        <p>
          {refund ? `${formatMoney(refund.amount)} was refunded to your card${refund.resolvedAt ? ` on ${formatDate(refund.resolvedAt)}` : ""}.` : "This order was refunded in full."} Banks usually take 5 to 10 business days. The tickets are no longer valid.
        </p>
      </Notice>
    );
  }
  if (projection === "refund-processing") return <Notice role="status" title="Refund processing"><p>{society} has started a refund. Banks usually take 5 to 10 business days once it goes through.</p></Notice>;
  if (projection === "cancelled") return <Notice title="Cancelled by the society"><p>{society} cancelled this free registration. Nothing was charged, so there is nothing to refund, and the tickets are no longer valid.</p></Notice>;
  if (projection === "disputed") return <Notice title="Payment disputed" tone="warning"><p>Your bank has disputed this payment, so the tickets are under review. Contact {society} before the event.</p></Notice>;
  if (projection === "review") {
    return order.requiresCompensationReview ? (
      <Notice title="Payment received, tickets not issued" tone="warning"><p>We couldn&apos;t issue your tickets after your payment went through. {society} will sort it out; contact them if you haven&apos;t heard back.</p></Notice>
    ) : (
      <Notice title="Partly refunded"><p>{formatMoney(order.externalRefundedAmount)} of {formatMoney(order.totalAmount)} was refunded to your card. Your tickets are still valid.</p></Notice>
    );
  }
  return null;
}

export default async function PurchasePage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  let user: Awaited<ReturnType<typeof requireAuthenticatedUser>>;
  try {
    user = await requireAuthenticatedUser();
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect(`/login?callbackUrl=/purchases/tickets/${orderId}`);
    throw error;
  }
  // Another member's order, or none, is the same 404.
  const order = await getOwnTicketPurchase(user.id, orderId);
  if (!order) notFound();

  const { event } = order;
  const { organisation } = event;
  const badge = buyerPurchaseBadge(order);
  const projection = ticketOrderProjection(order);
  const ticketType = purchasedTicketTypeLabel(order.purchasedTicketTypeName, order.ticketType.name);
  const totalLabel = order.paymentKind === "free" ? "Free" : projection === "failed" || projection === "expired" ? "Not charged" : "Paid";

  return (
    <PersonalShell>
      <div className="grid gap-1">
        <Link className="w-fit text-sm font-semibold text-brand underline underline-offset-4" href="/purchases">Purchases</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold text-ink [overflow-wrap:anywhere]">{event.title}</h1>
          <StatusBadge label={badge.label} status={badge.status} />
        </div>
        <p className="text-ink-soft [overflow-wrap:anywhere]">
          {formatDateRange(event.startTime, event.endTime, organisation.timeZone)}, {zoneCity(organisation.timeZone)} time · {event.location}
        </p>
      </div>
      <StatusNotice order={order} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold text-ink">Your tickets</h2>
          {order.tickets.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">No tickets were issued for this order.</p>
          ) : (
            <ul className="mt-3 grid gap-2">
              {order.tickets.map((ticket) => {
                const state = ticketState(ticket, organisation.timeZone);
                return (
                  <li className="flex flex-wrap items-center justify-between gap-2" key={ticket.id}>
                    <span className="text-ink">{ticketType}</span>
                    <span className="flex items-center gap-2 text-sm text-ink-soft">
                      <span className="font-mono" title={ticket.id}>Ticket {ticketReference(ticket.id)}</span>
                      <StatusBadge label={state.label} status={state.status} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 flex justify-between border-t border-line pt-3 font-semibold text-ink">
            <span>{totalLabel}</span>
            <span className="tabular-nums">{order.paymentKind === "free" ? "Free" : formatPrice(order.totalAmount)}</span>
          </div>
          <p className="mt-1 text-[13px] text-ink-muted">Order {order.id.slice(-6).toUpperCase()}</p>
          {order.tickets.some((ticket) => ticket.validity === "active") ? (
            <Link className="mt-3 inline-block font-semibold text-brand underline underline-offset-4" href="/tickets">Show tickets in My tickets</Link>
          ) : null}
        </Card>
        <div className="grid gap-6">
          <AuditTimeline
            empty="Nothing has happened on this order yet."
            entries={order.history.map((entry) => ({ id: entry.id, title: entry.label, time: entry.createdAt }))}
            heading="What happened"
            timeZone={organisation.timeZone}
          />
          <Card>
            <h2 className="text-lg font-semibold text-ink">Need help?</h2>
            <p className="mt-2 text-sm text-ink-soft [overflow-wrap:anywhere]">
              {organisation.name}
              {organisation.supportEmail ? <>: <a className="font-semibold text-brand underline underline-offset-4" href={`mailto:${organisation.supportEmail}`}>{organisation.supportEmail}</a></> : null}
              {organisation.refundPolicy ? `. ${organisation.refundPolicy}` : "."}
            </p>
          </Card>
        </div>
      </div>
    </PersonalShell>
  );
}
