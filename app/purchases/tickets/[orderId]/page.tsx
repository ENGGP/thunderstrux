import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PersonalShell } from "@/components/layout/personal-shell";
import { PaymentStatusPoller } from "@/components/purchases/payment-status-poller";
import { TicketOrderNotice } from "@/components/purchases/ticket-order-notice";
import { UnpaidOrderNotice } from "@/components/purchases/unpaid-order-notice";
import { ticketReference, ticketState } from "@/components/tickets/ticket-face";
import { AuditTimeline } from "@/components/ui/audit-timeline";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/auth/access";
import { formatDate, formatDateRange, formatMoney, formatPrice } from "@/lib/format";
import { buyerPurchaseBadge, purchasedTicketTypeLabel, ticketOrderProjection } from "@/lib/purchases/projection";
import { cancelledByBuyer, pendingCheckoutState } from "@/lib/purchases/pending-checkout";
import { getOwnTicketPurchase } from "@/lib/purchases/ticket-purchases";
import { zoneCity } from "@/lib/zoned-time";

export const metadata: Metadata = { title: "Purchase", robots: { index: false, follow: false } };

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
  const projection = ticketOrderProjection(order);
  // An unpaid order asks Stripe where it stands (round E1); a closed one, whether the buyer cancelled it.
  const [checkout, cancelled] = await Promise.all([
    projection === "processing" ? pendingCheckoutState({ kind: "ticket", id: order.id }) : null,
    projection === "expired" ? cancelledByBuyer({ kind: "ticket", id: order.id }) : false
  ]);
  const badge = checkout?.state === "confirming" ? { status: "processing" as const, label: "Confirming payment" } : checkout?.state === "ended" ? { status: "expired" as const, label: "Didn't complete" } : buyerPurchaseBadge(order);
  const ticketType = purchasedTicketTypeLabel(order.purchasedTicketTypeName, order.ticketType.name);
  const notCharged = projection === "failed" || projection === "expired" || checkout?.state === "ended";
  const totalLabel = order.paymentKind === "free" ? "Free" : notCharged ? "Not charged" : checkout?.state === "waiting" ? "To pay" : "Paid";

  return (
    <PersonalShell>
      <div className="grid gap-1">
        <Link className="w-fit text-sm font-semibold text-brand underline underline-offset-4" href="/purchases">Purchases</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold text-ink [overflow-wrap:anywhere]">{event.title}</h1>
          <StatusBadge label={badge.label} status={badge.status} />
        </div>
        <p className="text-ink-soft [overflow-wrap:anywhere]">
          {formatDateRange(event.startTime, event.endTime, organisation.timeZone)}, {zoneCity(organisation.timeZone)} · {event.location}
        </p>
      </div>
      <TicketOrderNotice cancelled={cancelled} order={order} processing={checkout ? (
        <UnpaidOrderNotice
          backHref={`/events/${event.id}`}
          cancelUrl={`/api/purchases/tickets/${order.id}/cancel`}
          checkout={checkout}
          confirming={
            <Notice role="status" title="Confirming your payment">
              <p>Stripe has your payment and is telling us about it. This usually takes under a minute; this page updates by itself.</p>
              <PaymentStatusPoller orderId={order.id} />
            </Notice>
          }
          held={{ what: `${order.quantity} ${order.quantity === 1 ? "ticket" : "tickets"}`, many: order.quantity > 1, event: event.title }}
          timeZone={organisation.timeZone}
        />
      ) : null} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold text-ink">Your tickets</h2>
          {order.tickets.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">{checkout && checkout.state !== "ended" ? `Your ${order.quantity === 1 ? "ticket is" : "tickets are"} issued once Stripe confirms the payment.` : "No tickets were issued for this order."}</p>
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
