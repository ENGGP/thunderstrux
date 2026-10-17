import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { OrderDetailActions } from "@/components/orders/order-detail-actions";
import { OrderReviewActions } from "@/components/orders/order-review-actions";
import { requireManagementPage } from "@/lib/auth/page-access";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatDateTime, formatMoney, formatPrice } from "@/lib/format";
import { orderReference } from "@/lib/payments/order-refunds";
import { mfaEnforcementMode } from "@/lib/security/staff-mfa";
import { roleHasPermission } from "@/lib/staff/live-authority";
import { isLiveStripeKey } from "@/lib/stripe";
import {
  OrganisationOrderAccessError,
  getOrganisationOrderDetail
} from "@/lib/orders/order-detail";
import {
  getOrganisationOrderLifecycle,
  parseOrderLifecycleCursor
} from "@/lib/payments/order-lifecycle-history";

function buyerName(user: {
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
}) {
  if (user.displayName) {
    return user.displayName;
  }

  return [user.firstName, user.lastName].filter(Boolean).join(" ") || null;
}

export default async function OrganisationOrderDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ historyCursor?: string; historyDirection?: string }>;
}) {
  const { orderId } = await params;
  const historySearchParams = await searchParams;
  const historyQuery = parseOrderLifecycleCursor(
    historySearchParams.historyCursor,
    historySearchParams.historyDirection
  );
  const organisation = await requireManagementPage("orders:read", `/dashboard/orders/${orderId}`);

  let order: Awaited<ReturnType<typeof getOrganisationOrderDetail>>;
  let lifecycle: Awaited<ReturnType<typeof getOrganisationOrderLifecycle>>;

  try {
    order = await getOrganisationOrderDetail(organisation.id, orderId);
    lifecycle = await getOrganisationOrderLifecycle(
      organisation.id,
      orderId,
      historyQuery
    );
  } catch (error) {
    if (error instanceof OrganisationOrderAccessError) {
      notFound();
    }

    throw error;
  }

  const canRefund = roleHasPermission(organisation.staffRole, "orders:refund");
  // A partial refund made in Stripe leaves the rest to refund here.
  const refundable = order.paymentKind === "stripe" && order.status === "paid" && !order.requiresCompensationReview &&
    !order.refundStatus && !order.disputeStatus && !order.isManuallyRefunded;
  const buyer = order.user
    ? {
        email: order.user.email,
        name: buyerName(order.user)
      }
    : null;

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader
        badge={
          <StatusBadge
            label={order.isManuallyRefunded && order.projection === "paid" ? "Paid · recorded outside Thunderstrux" : undefined}
            status={order.projection}
          />
        }
        breadcrumbs={[{ label: "Orders", href: "/dashboard/orders" }]}
        title={`Order ${order.id.slice(-6).toUpperCase()}`}
      />

      {order.cancelledAt ? (
        <Notice title="Registration cancelled">
          <p>
            Cancelled on {formatDate(order.cancelledAt)}
            {order.cancelledBy ? ` by ${[order.cancelledBy.firstName, order.cancelledBy.lastName].filter(Boolean).join(" ") || order.cancelledBy.email}` : ""}:
            {" "}&ldquo;{order.cancellationReason}&rdquo;. Nothing was charged, so there is nothing to refund.
          </p>
        </Notice>
      ) : null}
      <RefundNotice order={order} />
      <ReviewNotice canAct={canRefund} order={order} />

      {order.requiresCompensationReview ? (
        <Notice title="Payment received, tickets not issued" tone="warning">
          <p>Review this order in Stripe before contacting the buyer or taking manual action.</p>
          {order.compensationRefundJob ? (
            <p className="mt-1">Refund workflow: {order.compensationRefundJob.state.replaceAll("_", " ")}</p>
          ) : null}
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold text-ink">Summary</h2>
          <dl className="mt-3 grid gap-x-6 gap-y-3 text-[15px] sm:grid-cols-[max-content_minmax(0,1fr)]">
            <dt className="text-ink-soft">Buyer</dt>
            <dd className="text-ink [overflow-wrap:anywhere]">
              {buyer?.name ? <span className="block">{buyer.name}</span> : null}
              {buyer?.email ?? "Unknown buyer"}
              {order.buyerIdentityProvenance === "current_account_at_capture" && order.buyerIdentityCapturedAt ? (
                <span className="mt-1 block text-sm text-ink-soft">
                  Contact details captured from the account profile on{" "}
                  {order.buyerIdentityCapturedAt.toISOString().slice(0, 10)}. Original purchase-time profile details
                  were not recorded.
                </span>
              ) : null}
            </dd>
            <dt className="text-ink-soft">Event</dt>
            <dd>
              <Link className="font-semibold text-brand underline underline-offset-4" href={`/dashboard/events/${order.event.id}`}>
                {order.event.title}
              </Link>
            </dd>
            <dt className="text-ink-soft">Tickets</dt>
            <dd className="text-ink">
              {order.quantity} × {order.purchasedTicketType} at {formatPrice(order.unitPrice)}
            </dd>
            <dt className="text-ink-soft">Total</dt>
            <dd className="font-semibold tabular-nums text-ink">{formatPrice(order.totalAmount)}</dd>
            <dt className="text-ink-soft">Ordered</dt>
            <dd className="text-ink">{formatDateTime(order.createdAt)}</dd>
            <dt className="text-ink-soft">Paid</dt>
            <dd className="text-ink">{formatDateTime(order.paidAt)}</dd>
            <dt className="text-ink-soft">Order ID</dt>
            <dd className="font-mono text-sm text-ink-soft [overflow-wrap:anywhere]">{order.id}</dd>
          </dl>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-ink">Manage this order</h2>
          <p className="mt-1 text-sm text-ink-soft">Only a refund through Stripe moves money; the other actions here don&apos;t.</p>
          <OrderDetailActions
            refund={
              canRefund && refundable
                ? { amount: formatMoney(order.totalAmount - order.externalRefundedAmount), rest: order.externalRefundedAmount > 0, buyer: buyer?.name ?? buyer?.email ?? "the buyer", reference: orderReference(order.id), ticketCount: order.quantity, needsCode: mfaEnforcementMode() !== "off" }
                : null
            }
            buyerEmail={buyer?.email ?? null}
            canResendTickets={order.tickets.length > 0 && !order.cancelledAt}
            disputed={Boolean(order.disputeStatus)}
            free={order.paymentKind === "free"}
            cancelFree={
              canRefund && order.paymentKind === "free" && order.status === "paid"
                ? { buyer: buyer?.name ?? buyer?.email ?? "the buyer", ticketCount: order.quantity, needsCode: mfaEnforcementMode() !== "off", cancelled: Boolean(order.cancelledAt) }
                : null
            }
            isManuallyRefunded={order.isManuallyRefunded}
            orderId={order.id}
            requiresCompensationReview={order.requiresCompensationReview}
            stripeDashboardUrl={order.stripeDashboardUrl}
            stripeSessionId={order.stripeSessionId}
          />
        </Card>
      </div>

      {/* Exactly one section holds the history, which the browser tests rely on. */}
      <Card>
        <h2 className="text-lg font-semibold text-ink">Order history</h2>
        {lifecycle.historyIncomplete ? (
          <p className="mt-2 text-sm text-ink-soft">
            This order predates lifecycle history. Earlier activity may not be shown.
          </p>
        ) : null}
        {lifecycle.events.length === 0 ? (
          <p className="mt-4 text-sm text-ink-soft">
            No lifecycle history has been recorded for this order yet.
          </p>
        ) : (
          <ol className="mt-3 divide-y divide-line">
            {lifecycle.events.map((event) => (
              <li className="break-words py-3" key={event.id}>
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <div>
                    <p className="text-[15px] font-semibold text-ink">{event.label}</p>
                    <p className="text-sm text-ink-soft">
                      {event.actorName ?? event.source.replaceAll("_", " ")}
                    </p>
                  </div>
                  <time className="text-sm text-ink-soft">{formatDateTime(event.createdAt)}</time>
                </div>
                {event.fromOrderStatus !== event.toOrderStatus && event.toOrderStatus ? (
                  <p className="mt-1 text-sm text-ink-soft">
                    Order: {event.fromOrderStatus ?? "unknown"} to {event.toOrderStatus}
                  </p>
                ) : null}
                {event.fromReservationStatus !== event.toReservationStatus && event.toReservationStatus ? (
                  <p className="mt-1 text-sm text-ink-soft">
                    Reservation: {event.fromReservationStatus ?? "none"} to {event.toReservationStatus}
                  </p>
                ) : null}
                {event.reason ? (
                  <p className="mt-1 text-sm text-ink-soft">
                    Reason: {event.reason.replaceAll("_", " ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        <div className="mt-3 flex items-center justify-between gap-4">
          {lifecycle.pageInfo.newerCursor ? (
            <Link
              className="text-sm font-semibold text-brand underline underline-offset-4"
              href={`/dashboard/orders/${order.id}?historyCursor=${lifecycle.pageInfo.newerCursor}&historyDirection=newer`}
            >
              Newer activity
            </Link>
          ) : <span />}
          {lifecycle.pageInfo.olderCursor ? (
            <Link
              className="text-sm font-semibold text-brand underline underline-offset-4"
              href={`/dashboard/orders/${order.id}?historyCursor=${lifecycle.pageInfo.olderCursor}&historyDirection=older`}
            >
              Older activity
            </Link>
          ) : null}
        </div>
      </Card>
    </DashboardShell>
  );
}

const refundFailures: Record<string, string> = {
  provider_refused: "Stripe refused the refund. Check the society's Stripe balance, then try again.",
  existing_refund_requires_review: "Stripe already has a refund for this payment. Review it in Stripe before refunding here.",
  provider_identity_not_eligible: "Stripe's record of this payment doesn't match the order, or it is disputed."
};

// Where the latest Thunderstrux refund stands. The tickets stay valid unless it succeeded.
function RefundNotice({ order }: { order: Awaited<ReturnType<typeof getOrganisationOrderDetail>> }) {
  const refund = order.latestRefund;
  if (!refund) return null;
  const by = refund.actor ? [refund.actor.firstName, refund.actor.lastName].filter(Boolean).join(" ") || refund.actor.email : "a staff member";
  if (order.refundStatus === "refunded" && refund.status === "succeeded") {
    return (
      <Notice role="status" title={`Refunded ${formatMoney(refund.amount)}`} tone="success">
        <p>Refunded {formatDateTime(refund.resolvedAt)} at the request of {by}: &ldquo;{refund.reason}&rdquo;. The tickets are no longer valid and the buyer was emailed.</p>
      </Notice>
    );
  }
  if (order.refundStatus === "processing") {
    return refund.status === "uncertain" ? (
      <Notice role="status" title="Checking the refund with Stripe">
        <p>We didn&apos;t get Stripe&apos;s answer. We&apos;re checking before anything is retried, so the buyer can&apos;t be refunded twice.</p>
      </Notice>
    ) : (
      <Notice role="status" title="Refund processing">
        <p>Stripe has the refund for {formatMoney(refund.amount)}. Banks usually take 5 to 10 business days to return the money.</p>
      </Notice>
    );
  }
  return refund.status === "failed" ? (
    <Notice title="The last refund didn't go through" tone="danger">
      <p>{refundFailures[refund.lastErrorCode ?? ""] ?? "Stripe didn't complete the refund."} The tickets are still valid.</p>
    </Notice>
  ) : null;
}

// What Stripe reported that Thunderstrux didn't do: a dispute, or a refund made
// in the Stripe dashboard. A dispute is not a refund.
function ReviewNotice({ order, canAct }: { order: Awaited<ReturnType<typeof getOrganisationOrderDetail>>; canAct: boolean }) {
  const dispute = order.latestDispute;
  if (order.disputeStatus && dispute) {
    const link = (
      <a className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4" href={`https://dashboard.stripe.com/${isLiveStripeKey() ? "" : "test/"}disputes/${dispute.stripeDisputeId}`} rel="noreferrer" target="_blank">
        Open the dispute in Stripe
      </a>
    );
    if (order.disputeStatus === "open") {
      return (
        <Notice title="The buyer has disputed this payment" tone="warning">
          <p>
            Their bank opened a dispute for {formatMoney(dispute.amount)} on {formatDate(dispute.createdAt)}.
            {dispute.evidenceDueBy ? ` Respond in Stripe by ${formatDate(dispute.evidenceDueBy)}.` : ""} Until it&apos;s resolved, refunds and
            resends are paused and the tickets show as &ldquo;Under review&rdquo; at the door.
          </p>
          {link}
        </Notice>
      );
    }
    if (order.disputeStatus === "won") {
      return (
        <Notice action={canAct ? <OrderReviewActions action="restore_tickets" orderId={order.id} /> : undefined} title="Stripe closed the dispute in the society's favour">
          <p>The tickets stay under review until an owner or finance manager restores them with a reason. Restoring doesn&apos;t move money.</p>
          {link}
        </Notice>
      );
    }
    return (
      <Notice title="The buyer won the dispute" tone="danger">
        <p>Their bank returned {formatMoney(dispute.amount)} to them{dispute.closedAt ? ` on ${formatDate(dispute.closedAt)}` : ""}. The tickets are no longer valid.</p>
        {link}
      </Notice>
    );
  }
  if (!order.externalRefundedAmount) return null;
  if (order.refundStatus === "refunded" && order.externalRefundedAmount >= order.totalAmount) {
    return (
      <Notice title="Fully refunded in Stripe">
        <p>{formatMoney(order.externalRefundedAmount)} was refunded from the Stripe dashboard. The tickets are no longer valid.</p>
      </Notice>
    );
  }
  if (order.refundStatus) return null;
  const part = `${formatMoney(order.externalRefundedAmount)} of ${formatMoney(order.totalAmount)} was refunded from the Stripe dashboard.`;
  return order.externalRefundReviewedAt ? (
    <Notice title="Partly refunded in Stripe">
      <p>{part} Reviewed on {formatDate(order.externalRefundReviewedAt)}; the tickets stay valid.</p>
    </Notice>
  ) : (
    <Notice action={canAct ? <OrderReviewActions action="mark_reviewed" orderId={order.id} /> : undefined} title="Partly refunded in Stripe: needs review" tone="warning">
      <p>{part} Thunderstrux can&apos;t tell which ticket that covers, so the tickets stay valid until you decide. Refund the rest below, or mark it as reviewed.</p>
    </Notice>
  );
}
