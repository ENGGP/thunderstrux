import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { StripeReviewNotice } from "@/components/commerce/stripe-review-notice";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireManagementPage } from "@/lib/auth/page-access";
import { commerceHappened } from "@/lib/commerce/history";
import { staffMembershipOrder } from "@/lib/commerce/orders";
import { formatDateTime, formatMoney, formatPrice, formatTerm, orderReference } from "@/lib/format";
import { readTimeZone } from "@/lib/organisations/profile";
import { hasOrganisationPermission } from "@/lib/permissions";
import { ticketOrderProjection } from "@/lib/purchases/projection";

export const metadata: Metadata = { title: "Membership order" };

const name = (person: { firstName: string | null; lastName: string | null; email: string } | null) =>
  person ? [person.firstName, person.lastName].filter(Boolean).join(" ") || person.email : null;

function Card({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid content-start gap-3.5 rounded-card border border-line bg-surface p-5 sm:p-6">
      <h2 className="font-display text-xl font-semibold text-ink" id={id}>
        {title}
      </h2>
      {children}
    </section>
  );
}

// A membership order that never became a membership (UI-067): a payment held for
// review, a dispute, or a checkout that didn't complete. Orders and the overview
// link here, so Needs review always reaches the order; a granted one goes to its
// member page, where refunds live.
export default async function MembershipOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const organisation = await requireManagementPage(["orders:read"], `/dashboard/memberships/orders/${orderId}`);
  const [order, timeZone] = await Promise.all([staffMembershipOrder(organisation.id, orderId), readTimeZone(organisation.id)]);
  if (!order) notFound();
  const grant = order.lines[0]?.membershipGrant;
  if (grant) redirect(`/dashboard/memberships/members/${grant.id}`);
  const when = (date: Date) => formatDateTime(date, { timeZone });
  const line = order.lines[0];
  const free = order.paymentKind === "free";
  const buyer = order.buyerNameSnapshot || order.buyerEmailSnapshot;

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <div className="grid gap-5">
        <PageHeader
          badge={<StatusBadge status={ticketOrderProjection(order)} />}
          breadcrumbs={[{ label: "Orders", href: "/dashboard/orders?family=memberships" }]}
          description={`${buyer} · no membership was granted`}
          title={`Order ${orderReference(order.id)}`}
        />

        {order.requiresCompensationReview ? (
          <Notice title="Payment review" tone="warning">
            <p className="mt-0.5">
              Stripe took a payment for a membership that couldn&apos;t be granted ({order.reviewReason ?? "under review"}).{" "}
              {order.disputeStatus === "open"
                ? "Stripe refuses a refund during a dispute: if the buyer wins, their bank returns the money, and if the society wins, Thunderstrux refunds it in full."
                : "Thunderstrux refunds it in full and emails the buyer; if Stripe refuses, finance sorts it out in Stripe."}
            </p>
          </Notice>
        ) : order.refundStatus === "processing" ? (
          <Notice role="status" title="Refund processing">
            <p className="mt-0.5">Stripe has the refund for {formatMoney(order.totalAmount)}.</p>
          </Notice>
        ) : null}
        {order.paidAt && order.refundStatus !== "refunded" ? (
          <StripeReviewNotice canAct={hasOrganisationPermission(organisation.staffRole, "orders:refund")} kind="membership" orderId={order.id} review={{ ...order, dispute: order.disputes[0] ?? null }} timeZone={timeZone} />
        ) : null}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-5">
            <Card id="membership-heading" title="Membership">
              {line ? (
                <p className="flex items-start justify-between gap-3 text-ui">
                  <span className="grid">
                    <span className="text-ink [overflow-wrap:anywhere]">{line.nameSnapshot}</span>
                    {line.termStartsAt && line.termEndsAt ? <span className="text-sm text-ink-soft">{formatTerm(line.termStartsAt, line.termEndsAt, timeZone)}</span> : null}
                  </span>
                  <span className="tabular-nums text-ink">{formatPrice(line.lineAmount)}</span>
                </p>
              ) : null}
              <p className="flex justify-between gap-3 border-t border-line pt-3 font-semibold tabular-nums text-ink">
                <span>{free ? "Total" : "Total paid"}</span>
                <span>{formatPrice(order.totalAmount)}</span>
              </p>
              {free ? null : (
                <p className="text-sm text-ink-soft">
                  Thunderstrux fee {formatMoney(order.feeAmount)}. Your society receives {formatMoney(order.totalAmount - order.feeAmount)} before any refunds; the fee includes card processing.
                </p>
              )}
            </Card>

            <Card id="history-heading" title="What happened">
              <ul className="grid gap-2.5 text-ui">
                {[...order.lifecycleEvents].reverse().filter((event) => commerceHappened[event.type]).map((event) => (
                  <li className="[overflow-wrap:anywhere]" key={event.sequence}>
                    <strong>{commerceHappened[event.type]}</strong>{" "}
                    <span className="text-sm text-ink-soft">
                      {when(event.createdAt)}
                      {name(event.actor) ? ` · ${name(event.actor)}` : ""}
                      {event.reason && event.type !== "compensation_required" ? ` · “${/^[a-z0-9_]+$/.test(event.reason) ? event.reason.replaceAll("_", " ") : event.reason}”` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <div className="grid gap-5">
            <Card id="buyer-heading" title="Buyer">
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-ui">
                <dt className="text-ink-soft">Name</dt>
                <dd className="[overflow-wrap:anywhere]">{order.buyerNameSnapshot ?? "Not given"}</dd>
                <dt className="text-ink-soft">Email</dt>
                <dd className="[overflow-wrap:anywhere]">{order.buyerEmailSnapshot}</dd>
                <dt className="text-ink-soft">Account</dt>
                <dd>{order.guestIdentityId ? "Guest" : "Member account"}</dd>
                <dt className="text-ink-soft">Ordered</dt>
                <dd>{when(order.createdAt)}</dd>
              </dl>
            </Card>
            <Card id="money-heading" title="Money">
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-ui">
                <dt className="text-ink-soft">Paid</dt>
                <dd>{free ? "Nothing, it was free" : order.paidAt ? `${formatMoney(order.totalAmount)} by card, through Stripe` : "Nothing, the checkout didn't complete"}</dd>
                <dt className="text-ink-soft">Refunded</dt>
                <dd>{order.refundStatus === "refunded" ? formatMoney(order.totalAmount) : order.refundStatus === "processing" ? "Processing" : order.externalRefundedAmount ? `${formatMoney(order.externalRefundedAmount)} in Stripe` : "Nothing"}</dd>
              </dl>
            </Card>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
