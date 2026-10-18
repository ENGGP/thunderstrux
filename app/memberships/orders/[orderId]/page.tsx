import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckoutShell } from "@/components/layout/checkout-shell";
import { PaymentStatusPoller } from "@/components/purchases/payment-status-poller";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getLiveSession } from "@/lib/auth/live-session";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { grantState } from "@/lib/memberships/grants";
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
  const order = await prisma.commerceOrder.findFirst({
    where: { id: orderId, userId: session.user.id, kind: "membership" },
    select: {
      id: true, status: true, requiresCompensationReview: true, sellerName: true,
      organisation: { select: { slug: true, timeZone: true } },
      lines: { take: 1, select: { nameSnapshot: true, membershipGrant: { select: { startsAt: true, endsAt: true, revokedAt: true } } } }
    }
  });
  if (!order) notFound();
  const line = order.lines[0];
  const grant = line?.membershipGrant ?? null;
  const zone = order.organisation.timeZone;
  const back = `/societies/${order.organisation.slug}/memberships`;
  const state = grant ? grantState(grant) : null;
  const waiting = order.status === "pending" && !order.requiresCompensationReview;
  const closed = !grant && (order.status === "failed" || order.status === "expired" || (waiting && left === "1"));

  const title = closed
    ? "No payment taken"
    : order.requiresCompensationReview
      ? "We're checking your payment"
      : waiting
        ? "Confirming your payment"
        : state === "upcoming"
          ? `You're a member from ${formatDate(grant!.startsAt, zone)}`
          : state === "active"
            ? "You're a member"
            : "Your membership";

  return (
    <CheckoutShell backHref={back} backLabel="Back to memberships" current={grant ? 2 : 1} society={order.sellerName} steps={["Review", "Pay with Stripe", "Membership"]} title={title}>
      <Card>
        <div className="grid gap-4">
          {closed ? (
            <>
              <p className="text-ink">
                {left === "1" && waiting ? "You left Stripe before paying" : "This checkout didn't complete"}, so you&apos;re not a member of {line?.nameSnapshot ?? "this term"}.
              </p>
              <div>
                <Link className={buttonClasses({ variant: "secondary", size: "lg" })} href={back}>
                  Back to memberships
                </Link>
              </div>
            </>
          ) : order.requiresCompensationReview ? (
            <p className="text-ink">Stripe took a payment we couldn&apos;t turn into a membership. {order.sellerName} has been asked to review it; you won&apos;t be charged twice.</p>
          ) : waiting ? (
            <>
              <div>
                <StatusBadge status="processing" />
              </div>
              <p className="text-ink" role="status">
                Stripe is telling us about your payment for {line?.nameSnapshot}. This page updates by itself.
              </p>
              <p className="text-sm text-ink-soft">You&apos;re not a member of this term until Stripe confirms. You won&apos;t be charged twice.</p>
              <PaymentStatusPoller orderId={order.id} statusUrl={`/api/commerce/orders/${order.id}`} slowMessage="Stripe hasn't confirmed yet. If you paid, the membership appears in My memberships when it does, and we'll email you." />
            </>
          ) : grant && state ? (
            <>
              <div>
                <StatusBadge status={state} />
              </div>
              <p className="text-ink">
                {state === "upcoming"
                  ? `Confirmed: your ${line?.nameSnapshot} membership with ${order.sellerName} begins on ${formatDate(grant.startsAt, zone)}, ${zoneCity(zone)}.`
                  : state === "active"
                    ? `Your ${line?.nameSnapshot} membership with ${order.sellerName} runs until ${formatDate(new Date(grant.endsAt.getTime() - 1), zone)}.`
                    : `This ${line?.nameSnapshot} membership has ${state === "revoked" ? "ended early" : "ended"}.`}{" "}
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
