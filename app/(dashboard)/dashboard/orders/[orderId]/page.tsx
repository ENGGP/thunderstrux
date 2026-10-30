import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { OrderDetailActions } from "@/components/orders/order-detail-actions";
import { OrderReviewActions } from "@/components/orders/order-review-actions";
import { AuditTimeline } from "@/components/ui/audit-timeline";
import { ticketState } from "@/components/tickets/ticket-face";
import { requireManagementPage } from "@/lib/auth/page-access";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatDateTime, formatMoney, formatPrice, ticketReference } from "@/lib/format";
import { readTimeZone } from "@/lib/organisations/profile";
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

export const metadata: Metadata = { title: "Order" };

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
  // Every date here is in the society's zone, as on the orders list and its filters.
  const timeZone = await readTimeZone(organisation.id);

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
  // What is still the buyer's to get back, after refunds here and in Stripe, and the tickets still valid (DEBT-002).
  const left = order.totalAmount - order.refundedAmount - order.externalRefundedAmount;
  const valid = order.tickets.filter((ticket) => ticket.validity === "active");
  const refundable = order.paymentKind === "stripe" && order.status === "paid" && !order.requiresCompensationReview &&
    !order.refundStatus && !order.disputeStatus && !order.isManuallyRefunded && (left > 0 || valid.length > 0);
  const buyer = order.user
    ? {
        email: order.user.email,
        name: buyerName(order.user)
      }
    : null;

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader
        badge={<StatusBadge status={order.projection} />}
        breadcrumbs={[{ label: "Orders", href: "/dashboard/orders" }]}
        title={`Order ${order.id.slice(-6).toUpperCase()}`}
      />

      {order.cancelledAt ? (
        <Notice title="Registration cancelled">
          <p>
            Cancelled on {formatDate(order.cancelledAt, timeZone)}
            {order.cancelledBy ? ` by ${[order.cancelledBy.firstName, order.cancelledBy.lastName].filter(Boolean).join(" ") || order.cancelledBy.email}` : ""}:
            {" "}&ldquo;{order.cancellationReason}&rdquo; Nothing was charged, so there is nothing to refund.
          </p>
        </Notice>
      ) : null}
      <RefundNotice order={order} timeZone={timeZone} />
      <ReviewNotice canAct={canRefund} order={order} timeZone={timeZone} />

      {order.requiresCompensationReview ? (
        <Notice title="Payment received, tickets not issued" tone="warning">
          <p>Review this order in Stripe before contacting the buyer or taking manual action.</p>
          {order.compensationRefundJob ? (
            <p className="mt-1">Refund workflow: {order.compensationRefundJob.state.replaceAll("_", " ")}</p>
          ) : null}
        </Notice>
      ) : null}

      {/* Manage spans both rows and its extra height goes to the 1fr row, so Tickets sits right under Summary. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2 lg:grid-rows-[auto_1fr]">
        <Card>
          <h2 className="text-lg font-semibold text-ink">Summary</h2>
          <dl className="mt-3 grid gap-x-6 gap-y-3 text-ui sm:grid-cols-[max-content_minmax(0,1fr)]">
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
            {order.codeSnapshot ? (
              <>
                <dt className="text-ink-soft">Code</dt>
                <dd className="text-ink"><span className="font-mono">{order.codeSnapshot}</span>, {formatMoney(order.discountAmount)} off</dd>
              </>
            ) : null}
            <dt className="text-ink-soft">Total</dt>
            <dd className="font-semibold tabular-nums text-ink">{formatPrice(order.totalAmount)}</dd>
            {order.refundedAmount > 0 ? (
              <>
                <dt className="text-ink-soft">Refunded</dt>
                <dd className="tabular-nums text-ink">{formatMoney(order.refundedAmount)}{order.refundedAmount < order.totalAmount ? ` of ${formatMoney(order.totalAmount)}` : ""}</dd>
              </>
            ) : null}
            <dt className="text-ink-soft">Ordered</dt>
            <dd className="text-ink">{formatDateTime(order.createdAt, { timeZone })}</dd>
            <dt className="text-ink-soft">Paid</dt>
            <dd className="text-ink">{formatDateTime(order.paidAt, { timeZone })}</dd>
            <dt className="text-ink-soft">Order ID</dt>
            <dd className="font-mono text-sm text-ink-soft [overflow-wrap:anywhere]">{order.id}</dd>
          </dl>
        </Card>

        <Card className="lg:row-span-2">
          <h2 className="text-lg font-semibold text-ink">Manage this order</h2>
          <p className="mt-1 text-sm text-ink-soft">Only a refund through Stripe moves money; the other actions here don&apos;t.</p>
          <OrderDetailActions
            refund={
              canRefund && refundable
                ? {
                    left,
                    unitPrice: order.unitPrice,
                    buyer: buyer?.name ?? buyer?.email ?? "the buyer",
                    reference: orderReference(order.id),
                    needsCode: mfaEnforcementMode() !== "off",
                    tickets: valid.map((ticket) => ({ id: ticket.id, reference: ticketReference(ticket.id), type: ticket.ticketType.name, checkedIn: Boolean(ticket.checkedInAt) }))
                  }
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
            markNeedsCode={mfaEnforcementMode() !== "off"}
            orderId={order.id}
            paid={order.status === "paid"}
            requiresCompensationReview={order.requiresCompensationReview}
            stripeDashboardUrl={order.stripeDashboardUrl}
            stripeSessionId={order.stripeSessionId}
          />
        </Card>
        {/* Each ticket and whether it still admits someone (DEBT-002): refunds can be ticket by ticket. */}
        {order.tickets.length ? (
          <Card>
            <h2 className="text-lg font-semibold text-ink">Tickets</h2>
            <ul className="mt-3 grid gap-2">
              {order.tickets.map((ticket) => (
                <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line pt-2 first:border-0 first:pt-0" key={ticket.id}>
                  <span className="text-ink [overflow-wrap:anywhere]">
                    <span className="font-mono">{ticketReference(ticket.id)}</span> · {ticket.ticketType.name}
                  </span>
                  <StatusBadge {...ticketState(ticket, timeZone)} />
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>

      {/* Exactly one section holds the history, which the browser tests rely on. */}
      <AuditTimeline
        empty="No lifecycle history has been recorded for this order yet."
        entries={lifecycle.events.map((event) => ({
          id: event.id,
          title: event.label,
          time: event.createdAt,
          meta: event.actorName ?? event.source.replaceAll("_", " "),
          details: [
            event.fromOrderStatus !== event.toOrderStatus && event.toOrderStatus ? `Order: ${event.fromOrderStatus ?? "unknown"} to ${event.toOrderStatus}` : null,
            event.fromReservationStatus !== event.toReservationStatus && event.toReservationStatus ? `Reservation: ${event.fromReservationStatus ?? "none"} to ${event.toReservationStatus}` : null,
            // A code (stripe_error, operator_requeue) reads with spaces; a reason staff typed reads as typed.
            event.reason ? `Reason: ${/^[a-z0-9_]+$/.test(event.reason) ? event.reason.replaceAll("_", " ") : event.reason}` : null
          ].filter((detail): detail is string => detail !== null)
        }))}
        footer={
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
        }
        heading="Order history"
        note={lifecycle.historyIncomplete ? "This order predates lifecycle history. Earlier activity may not be shown." : undefined}
        timeZone={timeZone}
      />
    </DashboardShell>
  );
}

const refundFailures: Record<string, string> = {
  provider_refused: "Stripe refused the refund. Check the society's Stripe balance, then try again.",
  existing_refund_requires_review: "Stripe already has a refund for this payment. Review it in Stripe before refunding here.",
  provider_identity_not_eligible: "Stripe's record of this payment doesn't match the order, or it is disputed."
};

// Where the latest Thunderstrux refund stands. The tickets stay valid unless it succeeded.
function RefundNotice({ order, timeZone }: { order: Awaited<ReturnType<typeof getOrganisationOrderDetail>>; timeZone: string }) {
  const refund = order.latestRefund;
  if (!refund) return null;
  const by = refund.actor ? [refund.actor.firstName, refund.actor.lastName].filter(Boolean).join(" ") || refund.actor.email : "a staff member";
  if (order.refundStatus === "refunded" && refund.status === "succeeded") {
    return (
      <Notice role="status" title={`Refunded ${formatMoney(order.refundedAmount)}`} tone="success">
        <p>Refunded {formatDateTime(refund.resolvedAt, { timeZone })} at the request of {by}: &ldquo;{refund.reason}&rdquo;. The tickets are no longer valid.</p>
      </Notice>
    );
  }
  // DEBT-002: some tickets refunded, others still valid.
  if (!order.refundStatus && refund.status === "succeeded") {
    return (
      <Notice role="status" title={`Partly refunded: ${formatMoney(order.refundedAmount)} of ${formatMoney(order.totalAmount)}`} tone="success">
        <p>The last refund, {formatMoney(refund.amount)}, went through {formatDateTime(refund.resolvedAt, { timeZone })} at the request of {by}: &ldquo;{refund.reason}&rdquo;. Each ticket&apos;s state is listed under Tickets.</p>
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
  if (refund.lastErrorCode === "refunded_elsewhere") {
    return <Notice role="status" title="Already refunded in Stripe"><p>A refund made in Stripe covered what this one was for, so nothing more was sent.</p></Notice>;
  }
  return refund.status === "failed" ? (
    <Notice title="The last refund didn't go through" tone="danger">
      <p>{refundFailures[refund.lastErrorCode ?? ""] ?? "Stripe didn't complete the refund."} The tickets are still valid.</p>
    </Notice>
  ) : null;
}

// What Stripe reported that Thunderstrux didn't do: a dispute, or a refund made
// in the Stripe dashboard. A dispute is not a refund.
function ReviewNotice({ order, canAct, timeZone }: { order: Awaited<ReturnType<typeof getOrganisationOrderDetail>>; canAct: boolean; timeZone: string }) {
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
            Their bank opened a dispute for {formatMoney(dispute.amount)} on {formatDate(dispute.createdAt, timeZone)}.
            {dispute.evidenceDueBy ? ` Respond in Stripe by ${formatDate(dispute.evidenceDueBy, timeZone)}.` : ""} Until it&apos;s resolved, refunds and
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
        <p>Their bank returned {formatMoney(dispute.amount)} to them{dispute.closedAt ? ` on ${formatDate(dispute.closedAt, timeZone)}` : ""}. The tickets are no longer valid.</p>
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
      <p>{part} Reviewed on {formatDate(order.externalRefundReviewedAt, timeZone)}; the tickets stay valid.</p>
    </Notice>
  ) : (
    <Notice
      action={
        canAct ? (
          <OrderReviewActions
            action="mark_reviewed"
            orderId={order.id}
            // The tickets the amount covers whole are picked first; staff change it, or pick none for a goodwill refund.
            preselect={Math.floor(order.externalRefundedAmount / order.unitPrice)}
            tickets={order.tickets.filter((ticket) => ticket.validity === "active").map((ticket) => ({ id: ticket.id, reference: ticketReference(ticket.id), type: ticket.ticketType.name }))}
          />
        ) : undefined
      }
      title="Partly refunded in Stripe: needs review"
      tone="warning"
    >
      <p>{part} Pick the tickets it covered: they stop working and go back on sale. Pick none to keep every ticket valid.</p>
    </Notice>
  );
}
