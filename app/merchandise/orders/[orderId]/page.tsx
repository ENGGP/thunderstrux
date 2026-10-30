import { HoldCountdown } from "@/components/purchases/hold-countdown";
import { ContactSocietyLink } from "@/components/organisations/contact-society-link";
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { CheckoutShell } from "@/components/layout/checkout-shell";
import { ClearBasket } from "@/components/merchandise/checkout";
import { formatTime } from "@/components/calendar/layout";
import { PaymentStatusPoller } from "@/components/purchases/payment-status-poller";
import { UnpaidOrderActions } from "@/components/purchases/unpaid-order-actions";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getLiveSession } from "@/lib/auth/live-session";
import { getOwnCommerceOrder } from "@/lib/commerce/orders";
import { formatDateTime, formatPrice } from "@/lib/format";
import { canOpenGuestCommerceOrder, guestCookieName, readGuestSession } from "@/lib/guest/guest-access";
import { guestCsrfToken } from "@/lib/guest/guest-csrf";
import { orderReference } from "@/lib/payments/order-refunds";
import { cancelledByBuyer, pendingCheckoutState } from "@/lib/purchases/pending-checkout";

export const dynamic = "force-dynamic";
const pickupTitle = { pending: "Order confirmed", ready: "Ready to collect", collected: "Collected" } as const;
const pickupBadge = { pending: "preparing", ready: "ready-to-collect", collected: "collected" } as const;
const pickupSteps = [
  ["pending", "Preparing", "The society is getting your items ready. We'll email you when it's ready to collect."],
  ["ready", "Ready to collect", "Collect it in person with your order reference."],
  ["collected", "Collected", ""]
] as const;

export const metadata: Metadata = { title: "Your merchandise order", robots: { index: false, follow: false } };

// Where a merchandise checkout lands (T27b, design round B2): Stripe's success
// and cancel pages and a free order all come here. Arriving proves nothing;
// the page shows the order's real state, only to the member who bought it,
// the guest checkout session that bought it or its emailed purchase link
// (receipt or Find your purchase), and refreshes while Stripe
// confirms. Pickup states (Preparing, Ready to collect) arrive with T28.
export default async function MerchandiseOrderPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ left?: string }> }) {
  const [{ orderId }, { left }, session, cookieStore] = await Promise.all([params, searchParams, getLiveSession(), cookies()]);
  const guestSessionId = cookieStore.get(guestCookieName)?.value;
  const guest = session ? null : await readGuestSession(guestSessionId);
  if (!session && !guest) redirect(`/login?callbackUrl=${encodeURIComponent(`/merchandise/orders/${orderId}`)}`);
  const order = session
    ? await getOwnCommerceOrder({ userId: session.user.id }, orderId)
    : guest && (await canOpenGuestCommerceOrder(guest, orderId))
      ? await getOwnCommerceOrder({ guestIdentityId: guest.guestIdentityId }, orderId)
      : null;
  if (!order || order.kind !== "merchandise") notFound();

  const basket = `/societies/${order.organisation.slug}/merchandise/basket`;
  const free = order.paymentKind === "free";
  const reference = orderReference(order.id);
  const waiting = order.status === "pending" && !order.requiresCompensationReview;
  // An unpaid order asks Stripe where it stands (round E1); a closed one, whether the buyer cancelled it.
  const [checkout, cancelled] = await Promise.all([
    waiting ? pendingCheckoutState({ kind: "commerce", id: order.id }) : null,
    order.status === "expired" ? cancelledByBuyer({ kind: "commerce", id: order.id }) : false
  ]);
  const closed = !order.requiresCompensationReview && (order.status === "failed" || order.status === "expired" || checkout?.state === "ended");
  const paid = order.status === "paid";
  const count = order.lines.reduce((total, line) => total + line.quantity, 0);
  const what = `${count} ${count === 1 ? "item" : "items"} from ${order.sellerName}`;
  // A refund or a free cancellation ends the pickup unless it was already collected (T28b).
  const ended = order.refundStatus === "refunded" || order.cancelledAt !== null;
  const tracked = !ended || order.pickupStatus === "collected";
  const collectedAt = order.lifecycleEvents.findLast((event) => event.type === "pickup_collected")?.createdAt;
  const title = closed ? "No payment taken" : order.requiresCompensationReview ? "We're refunding your payment" : checkout?.state === "waiting" ? "You haven't paid yet" : waiting ? "Confirming your payment" : paid ? (order.refundStatus === "refunded" ? "Refunded" : order.cancelledAt ? "Cancelled" : pickupTitle[order.pickupStatus ?? "pending"]) : "Your order";
  const steps = [...(guest ? ["Your email"] : []), "Review", ...(free ? [] : ["Pay with Stripe"]), "Pickup"];

  return (
    <CheckoutShell lead="Buying from" backHref={`/societies/${order.organisation.slug}/merchandise`} backLabel="Back to merchandise" current={paid ? steps.length - 1 : steps.length - 2} society={order.sellerName} steps={steps} title={title}>
      <Card>
        <div className="grid gap-4">
          {closed ? (
            <>
              <p className="text-ink">{cancelled ? "You cancelled this order, so nothing was charged and the items are back on sale." : "This checkout didn't complete, so nothing was charged."} Your basket is still here.</p>
              <div>
                <Link className={buttonClasses({ variant: "secondary", size: "lg" })} href={basket}>
                  Back to basket
                </Link>
              </div>
            </>
          ) : order.requiresCompensationReview ? (
            <p className="text-ink">Stripe took a payment for {what} that we couldn&apos;t fill, for example because it sold out first, so we&apos;re refunding it in full. We&apos;ll email you when it&apos;s done.</p>
          ) : checkout?.state === "waiting" ? (
            <>
              <div>
                <StatusBadge label="Waiting for payment" status="processing" />
              </div>
              <p className="text-ink">
                {left === "1" ? "You left Stripe before paying, so nothing was charged. " : ""}We&apos;re holding {what} for you until {formatTime(checkout.holdEndsAt, order.organisation.timeZone)}: <HoldCountdown endsAt={checkout.holdEndsAt.toISOString()} /> Pay on Stripe to get {count === 1 ? "it" : "them"}, or cancel and {count === 1 ? "it goes" : "they go"} back on sale. Nothing has been charged.
              </p>
              <UnpaidOrderActions cancelUrl={`/api/commerce/orders/${order.id}/cancel`} confirmText={`The ${what} you're holding ${count === 1 ? "goes" : "go"} back on sale.`} guestCsrf={guest && guestSessionId ? guestCsrfToken(guestSessionId) : undefined} paymentUrl={checkout.paymentUrl} stacked title="Cancel this order?" />
            </>
          ) : waiting ? (
            <>
              <div>
                <StatusBadge label="Confirming payment" status="processing" />
              </div>
              <p className="text-ink" role="status">
                Stripe has your payment for {what} and is telling us about it. This page updates by itself.
              </p>
              <p className="text-sm text-ink-soft">Your order isn&apos;t confirmed until Stripe does. You won&apos;t be charged twice.</p>
              <PaymentStatusPoller orderId={order.id} slowMessage="Stripe hasn't confirmed yet. If you paid, we'll email your receipt when it does." statusUrl={`/api/commerce/orders/${order.id}`} />
            </>
          ) : paid ? (
            <>
              <ClearBasket society={order.organisation.slug} />
              <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-3 gap-y-2 text-sm">
                <dt className="text-ink-soft">Payment</dt>
                <dd>
                  <StatusBadge status={order.cancelledAt ? "cancelled" : order.refundStatus === "refunded" ? "refunded" : order.refundStatus === "processing" ? "refund-processing" : free ? "free" : "paid"} />
                </dd>
                <dt className="text-ink-soft">Pickup</dt>
                <dd>{tracked ? <StatusBadge status={pickupBadge[order.pickupStatus ?? "pending"]} /> : "Not collected, nothing to pick up"}</dd>
              </dl>
              {order.refundStatus === "refunded" ? (
                <p className="text-ink">{formatPrice(order.totalAmount)} was refunded to your card. Banks usually take 5 to 10 business days.</p>
              ) : order.cancelledAt ? (
                <p className="text-ink">{order.sellerName} cancelled this free order. Nothing was charged.</p>
              ) : order.refundStatus === "processing" ? (
                <p className="text-ink">{order.sellerName} is refunding this order. We&apos;ll email you when Stripe confirms it.</p>
              ) : null}
              {tracked ? <ol aria-label="Pickup progress" className="grid gap-2.5 text-sm">
                {pickupSteps.map(([key, label, hint], index) => {
                  const at = pickupSteps.findIndex(([step]) => step === (order.pickupStatus ?? "pending"));
                  return (
                    <li className="flex items-start gap-2.5" key={key}>
                      <span aria-hidden="true" className={`mt-1 size-3 shrink-0 rounded-full border-2 ${index < at || (index === at && key === "collected") ? "border-brand bg-brand" : index === at ? "border-brand" : "border-line"}`} />
                      <span className={index === at ? "text-ink" : "text-ink-soft"}>
                        {index === at ? <strong>{label}</strong> : label}
                        {index === at && hint ? <span className="block text-ink-soft">{hint}</span> : null}
                        {index === at && key === "collected" && collectedAt ? <span className="block text-ink-soft">On {formatDateTime(collectedAt, { timeZone: order.organisation.timeZone })}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ol> : null}
              <ul className="grid gap-1.5 border-t border-line pt-3 text-ui text-ink">
                {order.lines.map((line) => (
                  <li className="flex justify-between gap-3" key={line.lineNumber}>
                    <span className="[overflow-wrap:anywhere]">
                      {line.quantity} × {line.nameSnapshot}
                      {line.variantSnapshot ? ` · ${line.variantSnapshot}` : ""}
                    </span>
                    <span className="tabular-nums">{formatPrice(line.lineAmount)}</span>
                  </li>
                ))}
              </ul>
              <p className="font-semibold text-ink">
                {free ? "Free" : `Paid ${formatPrice(order.totalAmount)}`} · Order {reference}
              </p>
              {order.pickupStatus === "collected" || ended ? null : <div className="grid gap-1 rounded-control bg-surface-subtle p-3.5 text-ui">
                <strong>Collect it in person</strong>
                {order.organisation.pickupPolicy ? <span className="whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">{order.organisation.pickupPolicy}</span> : null}
                <span className="text-ink-soft">
                  Show order <strong className="text-ink">{reference}</strong> when you collect. We&apos;ve emailed your receipt.
                </span>
              </div>}
              <ContactSocietyLink slug={order.organisation.slug} society={order.sellerName} />
              {order.sellerSupportEmail ? (
                <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
                  Or email{" "}
                  <a className="font-semibold text-brand underline" href={`mailto:${order.sellerSupportEmail}`}>
                    {order.sellerSupportEmail}
                  </a>
                </p>
              ) : null}
              {guest ? (
                <p className="text-sm text-ink-muted">
                  Lost this page?{" "}
                  <Link className="text-brand underline underline-offset-4" href="/guest/recover">
                    Find your purchase
                  </Link>{" "}
                  sends a fresh link for each purchase.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-ink">This order is closed. Ask {order.sellerName} if you have a question about it.</p>
          )}
        </div>
      </Card>
    </CheckoutShell>
  );
}
