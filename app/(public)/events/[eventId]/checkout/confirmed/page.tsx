import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckoutShell } from "@/components/layout/checkout-shell";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getLiveSession } from "@/lib/auth/live-session";
import { getPublishedEventDetail } from "@/lib/events/public-events";
import { formatDateTime } from "@/lib/format";
import { getMemberTicketOrder } from "@/lib/orders/member-tickets";
import { purchasedTicketTypeLabel } from "@/lib/purchases/projection";
import { zoneCity } from "@/lib/zoned-time";

export const metadata: Metadata = { title: "Tickets confirmed" };

// Where a finished checkout lands: the buyer's own order with its ticket
// numbers. Another member's order, or one for a different event, is a 404.
export default async function CheckoutConfirmedPage({
  params,
  searchParams
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ orderId?: string }>;
}) {
  const [{ eventId }, { orderId }, session] = await Promise.all([params, searchParams, getLiveSession()]);
  if (!session) redirect(`/login?callbackUrl=${encodeURIComponent(`/events/${eventId}`)}`);

  const [event, order] = await Promise.all([
    getPublishedEventDetail(eventId),
    orderId ? getMemberTicketOrder(session.user.id, eventId, orderId) : null
  ]);
  if (!event || !order) notFound();

  const free = order.paymentKind === "free";
  const count = order.tickets.length;
  const { organisation } = event;

  return (
    <CheckoutShell
      current={free ? 1 : 2}
      society={organisation.name}
      steps={free ? ["Review", "Tickets"] : ["Review", "Pay with Stripe", "Tickets"]}
      title={free ? "Free registration confirmed" : "Booking confirmed"}
    >
      <Card>
        <div className="grid gap-4">
          <p className="text-ink" role="status">
            Your {count} {count === 1 ? "ticket is" : "tickets are"} ready. We&apos;ve emailed{" "}
            {count === 1 ? "it" : "them"} to {order.buyerEmailSnapshot ?? session.user.email}.
          </p>
          {event.heroAssetId ? (
            <img alt="" className="aspect-video w-full max-w-md rounded-control border border-line object-cover" src={`/api/public/assets/${event.heroAssetId}`} />
          ) : null}
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold text-ink [overflow-wrap:anywhere]">{event.title}</h2>
            <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
              {formatDateTime(event.startTime, { dateStyle: "full", timeZone: organisation.timeZone })}, {zoneCity(organisation.timeZone)} · {event.location}
            </p>
          </div>
          <p className="text-ink">
            {order.quantity} × {purchasedTicketTypeLabel(order.purchasedTicketTypeName, order.ticketType.name)}
          </p>
          <ul aria-label="Ticket numbers" className="flex flex-wrap gap-2">
            {order.tickets.map((ticket) => (
              <li className="rounded-tag border border-line bg-surface-subtle px-2 py-0.5 font-mono text-sm text-ink" key={ticket.id} title={ticket.id}>
                Ticket {ticket.id.slice(-6)}
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-soft">Show your name and ticket number at the door.</p>
          <div className="flex flex-wrap gap-3">
            <Link className={buttonClasses()} href="/tickets">
              View my tickets
            </Link>
            <Link className={buttonClasses({ variant: "tertiary" })} href={`/events/${eventId}`}>
              Back to the event
            </Link>
          </div>
        </div>
      </Card>
    </CheckoutShell>
  );
}
