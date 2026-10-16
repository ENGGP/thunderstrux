import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckoutShell } from "@/components/layout/checkout-shell";
import { CheckoutAction } from "@/components/purchases/checkout-action";
import { MoneySummary } from "@/components/purchases/money-summary";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Notice } from "@/components/ui/notice";
import { getLiveSession } from "@/lib/auth/live-session";
import { getPublishedEventDetail } from "@/lib/events/public-events";
import { formatDateTime, formatMoney } from "@/lib/format";
import { reservationMinutes } from "@/lib/tickets/reservations";
import { maxTicketsPerOrder } from "@/lib/validators/payments";
import { zoneCity } from "@/lib/zoned-time";

export const metadata: Metadata = { title: "Checkout" };

// One review page for every ticket purchase (decided 2026-10-18): it confirms a
// free registration here or hands a paid one to Stripe. What it shows is a
// quote; checkout re-checks price, stock, sale state and payments under locks.
export default async function CheckoutPage({
  params,
  searchParams
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ ticketTypeId?: string; quantity?: string }>;
}) {
  const [{ eventId }, query, session] = await Promise.all([params, searchParams, getLiveSession()]);
  const eventHref = `/events/${eventId}`;
  // Event pages are public; buying needs a member account, and sign-in comes straight back here.
  if (!session) {
    const back = new URLSearchParams({ ticketTypeId: query.ticketTypeId ?? "", quantity: query.quantity ?? "" });
    redirect(`/login?callbackUrl=${encodeURIComponent(`/events/${eventId}/checkout?${back}`)}`);
  }
  if (session.user.accountRole !== "member") redirect(eventHref);

  const event = await getPublishedEventDetail(eventId);
  if (!event) notFound();

  const ticketType = event.ticketTypes.find((type) => type.id === query.ticketTypeId);
  const quantity = Number(query.quantity);
  if (!ticketType || !Number.isInteger(quantity) || quantity < 1 || quantity > maxTicketsPerOrder) redirect(eventHref);

  const free = ticketType.price === 0;
  const total = ticketType.price * quantity;
  const { organisation } = event;
  const buyerName = [session.user.firstName, session.user.lastName].filter(Boolean).join(" ") || session.user.name || "You";
  const callback = `/events/${eventId}/checkout?ticketTypeId=${ticketType.id}&quantity=${quantity}`;
  const policy = [
    organisation.refundPolicy ? `${free ? "Can't make it? " : "Refunds: "}${organisation.refundPolicy}` : null,
    organisation.supportEmail ? `Questions: ${organisation.supportEmail}` : null
  ].filter(Boolean);

  return (
    <CheckoutShell
      aside={
        <Card>
          <div className="grid gap-4">
            {event.heroAssetId ? (
              <img alt="" className="aspect-video w-full rounded-control border border-line object-cover" src={`/api/public/assets/${event.heroAssetId}`} />
            ) : null}
            <div className="grid gap-1.5">
              <h2 className="text-lg font-semibold text-ink [overflow-wrap:anywhere]">{event.title}</h2>
              <p className="inline-flex items-start gap-2 text-sm text-ink-soft">
                <Icon className="mt-0.5" name="calendar" />
                {formatDateTime(event.startTime, { dateStyle: "full", timeZone: organisation.timeZone })}, {zoneCity(organisation.timeZone)}
              </p>
              <p className="inline-flex items-start gap-2 text-sm text-ink-soft [overflow-wrap:anywhere]">
                <Icon className="mt-0.5" name="pin" />
                {event.location}
              </p>
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <span className="font-semibold text-ink">Total</span>
              <span className="text-lg font-semibold tabular-nums text-ink">{free ? "Free" : formatMoney(total)}</span>
            </div>
            {session.user.emailVerifiedAt ? (
              <CheckoutAction
                backHref={eventHref}
                eventId={event.id}
                eventTitle={event.title}
                freeTicketsAvailable={event.ticketTypes.some((type) => type.price === 0 && type.availableQuantity > 0)}
                label={free ? "Confirm free registration" : `Pay ${formatMoney(total)}`}
                quantity={quantity}
                society={organisation.name}
                ticketTypeId={ticketType.id}
                ticketTypeName={ticketType.name}
                unitPrice={ticketType.price}
              />
            ) : (
              <Notice title="Verify your email to continue">
                <p>Tickets are emailed to you, so we need to know the address works.</p>
                <Link
                  className="mt-1 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
                  href={`/verify-email?callbackUrl=${encodeURIComponent(callback)}`}
                >
                  Verify email
                </Link>
              </Notice>
            )}
            {free ? null : <p className="text-[13px] text-ink-muted">You pay on Stripe&apos;s secure page, then come back here.</p>}
          </div>
        </Card>
      }
      backHref={eventHref}
      current={0}
      society={organisation.name}
      steps={free ? ["Review", "Tickets"] : ["Review", "Pay with Stripe", "Tickets"]}
      title={free ? "Confirm your free tickets" : "Review your order"}
    >
      <Card>
        <h2 className="mb-4 text-lg font-semibold text-ink">Your tickets</h2>
        <MoneySummary
          lines={[{ label: ticketType.name, quantity, unitPrice: ticketType.price }]}
          note={free ? "No payment needed." : "No booking fee. You pay the ticket price shown."}
        />
      </Card>
      <Card>
        <h2 className="text-lg font-semibold text-ink">Tickets go to</h2>
        <p className="mt-2 text-ink [overflow-wrap:anywhere]">
          {buyerName} · {session.user.email}
        </p>
        <p className="mt-1 text-sm text-ink-soft">We email your tickets, and they appear in My tickets.</p>
      </Card>
      {free && policy.length === 0 ? null : (
        <Card>
          <h2 className="text-lg font-semibold text-ink">{free ? "Before you register" : "Before you pay"}</h2>
          <ul className="mt-2 grid gap-1.5 text-sm text-ink-soft [overflow-wrap:anywhere]">
            {free ? null : <li>We hold these tickets for {reservationMinutes} minutes while you pay.</li>}
            {policy.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Card>
      )}
    </CheckoutShell>
  );
}
