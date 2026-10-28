import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckoutShell } from "@/components/layout/checkout-shell";
import { formatTime } from "@/components/calendar/layout";
import { PaymentStatusPoller } from "@/components/purchases/payment-status-poller";
import { UnpaidOrderActions } from "@/components/purchases/unpaid-order-actions";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { cancelledByBuyer, pendingCheckoutState } from "@/lib/purchases/pending-checkout";
import { getLiveSession } from "@/lib/auth/live-session";
import { formatDate, membershipLabel } from "@/lib/format";
import { grantState } from "@/lib/memberships/grants";
import { ownMembershipOrder } from "@/lib/memberships/offers";
import { zoneCity } from "@/lib/zoned-time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your membership", robots: { index: false, follow: false } };

// Where a membership checkout lands (T24a): Stripe's success and cancel pages
// both come here. Arriving proves nothing; the page shows the order's real
// state, only to the member who bought it, and refreshes while Stripe confirms.
export default async function MembershipOrderPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ left?: string }> }) {
  const [{ orderId }, { left }] = await Promise.all([params, searchParams]);
  const session = await getLiveSession();
  if (!session) redirect(`/login?callbackUrl=${encodeURIComponent(`/memberships/orders/${orderId}`)}`);
  const order = await ownMembershipOrder(session.user.id, orderId);
  if (!order) notFound();
  const line = order.lines[0];
  const grant = line?.membershipGrant ?? null;
  const zone = order.organisation.timeZone;
  const back = `/societies/${order.organisation.slug}/memberships`;
  const state = grant ? grantState(grant) : null;
  const waiting = order.status === "pending" && !order.requiresCompensationReview;
  // An unpaid order asks Stripe where it stands (round E1); a closed one, whether the buyer cancelled it.
  const [checkout, cancelled] = await Promise.all([
    waiting ? pendingCheckoutState({ kind: "commerce", id: order.id }) : null,
    order.status === "expired" ? cancelledByBuyer({ kind: "commerce", id: order.id }) : false
  ]);
  const closed = !grant && (order.status === "failed" || order.status === "expired" || checkout?.state === "ended");
  const plan = line ? membershipLabel(line.nameSnapshot) : "membership";

  const title = closed
    ? "No payment taken"
    : order.requiresCompensationReview
      ? "We're refunding your payment"
      : checkout?.state === "waiting"
        ? "You haven't paid yet"
        : waiting
          ? "Confirming your payment"
          : state === "upcoming"
          ? `You're a member from ${formatDate(grant!.startsAt, zone)}`
          : state === "active"
            ? "You're a member"
            : "Your membership";

  return (
    <CheckoutShell lead="Buying from" backHref={back} backLabel="Back to memberships" current={grant ? 2 : 1} society={order.sellerName} steps={["Review", "Pay with Stripe", "Membership"]} title={title}>
      <Card>
        <div className="grid gap-4">
          {closed ? (
            <>
              <p className="text-ink">
                {cancelled ? "You cancelled this order" : "This checkout didn't complete"}, so nothing was charged and you don&apos;t have the {plan}.
              </p>
              <div>
                <Link className={buttonClasses({ variant: "secondary", size: "lg" })} href={back}>
                  Back to memberships
                </Link>
              </div>
            </>
          ) : order.requiresCompensationReview ? (
            <p className="text-ink">Stripe took a payment we couldn&apos;t turn into a membership, so we&apos;re refunding it in full. We&apos;ll email you when it&apos;s done.</p>
          ) : checkout?.state === "waiting" ? (
            <>
              <div>
                <StatusBadge label="Waiting for payment" status="processing" />
              </div>
              <p className="text-ink">
                {left === "1" ? "You left Stripe before paying, so nothing was charged. " : ""}We&apos;re holding your {plan} for you until {formatTime(checkout.holdEndsAt, zone)}. Pay on Stripe to get it, or cancel the order. Nothing has been charged.
              </p>
              <UnpaidOrderActions cancelUrl={`/api/commerce/orders/${order.id}/cancel`} confirmText={`Your ${plan} with ${order.sellerName} won't be bought.`} paymentUrl={checkout.paymentUrl} stacked title="Cancel this order?" />
            </>
          ) : waiting ? (
            <>
              <div>
                <StatusBadge label="Confirming payment" status="processing" />
              </div>
              <p className="text-ink" role="status">
                Stripe has your payment for the {plan} and is telling us about it. This page updates by itself.
              </p>
              <p className="text-sm text-ink-soft">You&apos;re not a member of this term until Stripe confirms. You won&apos;t be charged twice.</p>
              <PaymentStatusPoller orderId={order.id} statusUrl={`/api/commerce/orders/${order.id}`} slowMessage="Stripe hasn't confirmed yet. If you paid, the membership appears in My memberships when it does, and we'll email you." />
              <Link className="w-fit font-semibold text-brand underline underline-offset-4" href="/purchases">See all purchases</Link>
            </>
          ) : grant && state ? (
            <>
              <div>
                <StatusBadge status={state} />
              </div>
              <p className="text-ink">
                {state === "upcoming"
                  ? `Payment confirmed for your ${membershipLabel(line?.nameSnapshot ?? "")} with ${order.sellerName}. Benefits begin on ${formatDate(grant.startsAt, zone)}, ${zoneCity(zone)}.`
                  : state === "active"
                    ? `Your ${membershipLabel(line?.nameSnapshot ?? "")} with ${order.sellerName} runs until ${formatDate(new Date(grant.endsAt.getTime() - 1), zone)}.`
                    : `This ${membershipLabel(line?.nameSnapshot ?? "")} has ${state === "revoked" ? "ended early" : "ended"}.`}{" "}
                {state === "upcoming" || state === "active" ? "We've emailed your receipt." : null}
              </p>
              <div>
                <Link className={buttonClasses({ size: "lg" })} href="/memberships">
                  View my memberships
                </Link>
              </div>
            </>
          ) : (
            <p className="text-ink">See My memberships for where this stands.</p>
          )}
        </div>
      </Card>
    </CheckoutShell>
  );
}
