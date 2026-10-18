import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { GuestEmailForm } from "@/components/guest/guest-email-form";
import { CheckoutShell } from "@/components/layout/checkout-shell";
import { CheckoutAction } from "@/components/purchases/checkout-action";
import { MoneySummary } from "@/components/purchases/money-summary";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Notice } from "@/components/ui/notice";
import { getLiveSession } from "@/lib/auth/live-session";
import { getPublishedEventDetail, priceForViewer } from "@/lib/events/public-events";
import { memberPricePlan } from "@/lib/memberships/offers";
import { guestCookieName, readGuestSession } from "@/lib/guest/guest-access";
import { guestCsrfToken } from "@/lib/guest/guest-csrf";
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
  searchParams: Promise<{ ticketTypeId?: string; quantity?: string; guest?: string }>;
}) {
  const [{ eventId }, query, session, cookieStore] = await Promise.all([params, searchParams, getLiveSession(), cookies()]);
  const eventHref = `/events/${eventId}`;
  // Event pages are public. A member buys signed in; a visitor either signs in
  // (and comes straight back) or continues as a guest with a verified email.
  const guestSessionId = session ? undefined : cookieStore.get(guestCookieName)?.value;
  const guest = guestSessionId ? await readGuestSession(guestSessionId) : null;
  const guestCheckout = guest?.purpose === "checkout" ? guest : null;
  const back = new URLSearchParams({ ticketTypeId: query.ticketTypeId ?? "", quantity: query.quantity ?? "" });
  if (!session && !guestCheckout && query.guest !== "1") {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/events/${eventId}/checkout?${back}`)}`);
  }
  if (session && session.user.accountRole !== "member") redirect(eventHref);

  const event = await getPublishedEventDetail(eventId);
  if (!event) notFound();

  const listed = event.ticketTypes.find((type) => type.id === query.ticketTypeId);
  // A member account with the right membership is quoted the member price; guests never are (T24b).
  const memberPlan = listed && listed.memberPrice !== null && session?.user.emailVerifiedAt ? await memberPricePlan(event.organisation.slug, session.user.id) : null;
  const ticketType = listed ? priceForViewer([listed], memberPlan !== null)[0] : undefined;
  const quantity = Number(query.quantity);
  if (!ticketType || !Number.isInteger(quantity) || quantity < 1 || quantity > maxTicketsPerOrder) redirect(eventHref);

  const free = ticketType.price === 0;
  const total = ticketType.price * quantity;
  const { organisation } = event;
  const callback = `/events/${eventId}/checkout?ticketTypeId=${ticketType.id}&quantity=${quantity}`;
  if (!session && !guestCheckout) {
    return (
      <CheckoutShell backHref={eventHref} current={0} society={organisation.name} steps={free ? ["Your email", "Confirm"] : ["Your email", "Review", "Pay with Stripe"]} title="Where should we send your tickets?">
        <Card>
          <GuestEmailForm callbackUrl={callback} endpoint="/api/guest/email/request" submitLabel="Email me a link" />
        </Card>
        <Card>
          <p className="flex justify-between gap-3 text-ink">
            <span className="[overflow-wrap:anywhere]">{event.title} · {quantity} × {ticketType.name}</span>
            <span className="font-semibold tabular-nums">{free ? "Free" : formatMoney(total)}</span>
          </p>
        </Card>
      </CheckoutShell>
    );
  }
  const buyerName = session ? [session.user.firstName, session.user.lastName].filter(Boolean).join(" ") || session.user.name || "You" : null;
  const buyerEmail = session ? session.user.email : guestCheckout?.email;
  const verified = session ? Boolean(session.user.emailVerifiedAt) : true;
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
            {verified ? (
              <CheckoutAction
                guestCsrf={guestCheckout && guestSessionId ? guestCsrfToken(guestSessionId) : undefined}
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
      current={guestCheckout ? 1 : 0}
      society={organisation.name}
      steps={guestCheckout ? (free ? ["Your email", "Confirm"] : ["Your email", "Review", "Pay with Stripe"]) : free ? ["Review", "Tickets"] : ["Review", "Pay with Stripe", "Tickets"]}
      title={free ? "Confirm your free tickets" : "Review your order"}
    >
      <Card>
        <h2 className="mb-4 text-lg font-semibold text-ink">Your tickets</h2>
        <MoneySummary
          lines={[{ label: memberPlan && ticketType.standardPrice != null ? `${ticketType.name} (member price)` : ticketType.name, quantity, unitPrice: ticketType.price }]}
          note={
            memberPlan && ticketType.standardPrice != null
              ? `Member price through your ${memberPlan} membership. If it ends while we hold your tickets, you keep this price.`
              : free
                ? "No payment needed."
                : "No booking fee. You pay the ticket price shown."
          }
        />
      </Card>
      <Card>
        <h2 className="text-lg font-semibold text-ink">Tickets go to</h2>
        <p className="mt-2 text-ink [overflow-wrap:anywhere]">
          {buyerName ? `${buyerName} · ` : null}{buyerEmail}
          {guestCheckout ? <span className="ml-2 text-sm font-semibold text-success">Confirmed</span> : null}
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          {guestCheckout ? (
            <>Buying as a guest. Lost the email later? <Link className="text-brand underline underline-offset-4" href="/guest/recover">Find your tickets</Link> with this address.</>
          ) : "We email your tickets, and they appear in My tickets."}
        </p>
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
