import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { OrderDetailActions } from "@/components/orders/order-detail-actions";
import { requireManagementPage } from "@/lib/auth/page-access";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime, formatMoney } from "@/lib/format";
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

  const buyer = order.user
    ? {
        email: order.user.email,
        name: buyerName(order.user)
      }
    : null;

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link
              className="text-sm font-medium text-ink-muted hover:text-brand"
              href="/dashboard/orders"
            >
              Back to orders
            </Link>
            <h1 className="mt-2 text-3xl font-semibold text-ink">
              Order detail
            </h1>
          </div>
          <StatusBadge status={order.status} />
        </div>

        <section className="rounded-card border border-line bg-surface p-6">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <p className="text-sm text-ink-muted">Order ID</p>
              <p className="mt-1 break-all text-sm font-medium text-ink">
                {order.id}
              </p>
            </div>
            <div>
              <p className="text-sm text-ink-muted">Created</p>
              <p className="mt-1 text-sm text-ink">
                {formatDateTime(order.createdAt)}
              </p>
            </div>
            <div>
              <p className="text-sm text-ink-muted">Paid</p>
              <p className="mt-1 text-sm text-ink">
                {formatDateTime(order.paidAt)}
              </p>
            </div>
            <div>
              <p className="text-sm text-ink-muted">Buyer</p>
              <p className="mt-1 text-sm text-ink">
                {buyer?.email ?? "Unknown buyer"}
              </p>
              {buyer?.name ? (
                <p className="mt-1 text-sm text-ink-muted">{buyer.name}</p>
              ) : null}
              {order.buyerIdentityCapturedAt && <p className="mt-2 text-sm text-ink-muted">Buyer contact details captured from the account profile on {order.buyerIdentityCapturedAt.toISOString().slice(0, 10)}. Original purchase-time profile details were not recorded.</p>}
            </div>
            <div>
              <p className="text-sm text-ink-muted">Event</p>
              <Link
                className="mt-1 inline-block text-sm font-medium text-ink hover:text-ink-soft"
                href={`/dashboard/events/${order.event.id}`}
              >
                {order.event.title}
              </Link>
            </div>
            <div>
              <p className="text-sm text-ink-muted">Total amount</p>
              <p className="mt-1 text-sm font-medium text-ink">
                {formatMoney(order.totalAmount)}
              </p>
            </div>
          </div>
          {order.isManuallyRefunded ? (
            <p className="mt-5 rounded-control border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
              This order is marked as manually refunded.
            </p>
          ) : null}
          {order.requiresCompensationReview ? (
            <div className="mt-5 rounded-control border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
              <p>Payment was received, but ticket fulfilment failed. Review this order in Stripe before contacting the buyer or taking manual action.</p>
              {order.compensationRefundJob ? (
                <p className="mt-1">Refund workflow: {order.compensationRefundJob.state.replaceAll("_", " ")}</p>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="rounded-card border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold text-ink">Tickets</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-ink-muted">
                  <th className="py-3 pr-4 font-medium">Ticket type</th>
                  <th className="py-3 pr-4 font-medium">Quantity</th>
                  <th className="py-3 pr-4 font-medium">Unit price</th>
                  <th className="py-3 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-3 pr-4 text-ink-soft">
                    {order.ticketType.name}
                  </td>
                  <td className="py-3 pr-4 text-ink-soft">{order.quantity}</td>
                  <td className="py-3 pr-4 text-ink-soft">
                    {formatMoney(order.unitPrice)}
                  </td>
                  <td className="py-3 text-ink-soft">
                    {formatMoney(order.totalAmount)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-card border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold text-ink">Order history</h2>
          {lifecycle.historyIncomplete ? (
            <p className="mt-2 text-sm text-warning">
              This order predates lifecycle history. Earlier activity may not be shown.
            </p>
          ) : null}
          {lifecycle.events.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">
              No lifecycle history has been recorded for this order yet.
            </p>
          ) : (
            <ol className="mt-4 divide-y divide-line">
              {lifecycle.events.map((event) => (
                <li className="break-words py-4" key={event.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {event.label}
                      </p>
                      <p className="mt-1 text-sm text-ink-muted">
                        {event.actorName ?? event.source.replaceAll("_", " ")}
                      </p>
                    </div>
                    <time className="text-sm text-ink-muted">
                      {formatDateTime(event.createdAt)}
                    </time>
                  </div>
                  {event.fromOrderStatus !== event.toOrderStatus && event.toOrderStatus ? (
                    <p className="mt-2 text-sm text-ink-soft">
                      Order: {event.fromOrderStatus ?? "unknown"} to {event.toOrderStatus}
                    </p>
                  ) : null}
                  {event.fromReservationStatus !== event.toReservationStatus && event.toReservationStatus ? (
                    <p className="mt-1 text-sm text-ink-soft">
                      Reservation: {event.fromReservationStatus ?? "none"} to {event.toReservationStatus}
                    </p>
                  ) : null}
                  {event.reason ? (
                    <p className="mt-1 text-sm text-ink-muted">
                      Reason: {event.reason.replaceAll("_", " ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
          <div className="mt-4 flex items-center justify-between gap-4">
            {lifecycle.pageInfo.newerCursor ? (
              <Link
                className="text-sm font-medium text-ink-soft hover:text-brand"
                href={`/dashboard/orders/${order.id}?historyCursor=${lifecycle.pageInfo.newerCursor}&historyDirection=newer`}
              >
                Newer activity
              </Link>
            ) : <span />}
            {lifecycle.pageInfo.olderCursor ? (
              <Link
                className="text-sm font-medium text-ink-soft hover:text-brand"
                href={`/dashboard/orders/${order.id}?historyCursor=${lifecycle.pageInfo.olderCursor}&historyDirection=older`}
              >
                Older activity
              </Link>
            ) : null}
          </div>
        </section>

        <section className="space-y-4 rounded-card border border-line bg-surface p-6">
          <div>
            <h2 className="text-lg font-semibold text-ink">Management</h2>
            <p className="mt-1 text-sm text-ink-muted">
              These actions do not change Stripe payment state.
            </p>
          </div>
          <OrderDetailActions
            canResendTickets={order.tickets.length > 0}
            isManuallyRefunded={order.isManuallyRefunded}
            orderId={order.id}
            requiresCompensationReview={order.requiresCompensationReview}
            stripeSessionId={order.stripeSessionId}
          />
          <div className="rounded-card border border-line p-4">
            <p className="text-sm text-ink-muted">Stripe session ID</p>
            <p className="mt-1 break-all text-sm text-ink">
              {order.stripeSessionId ?? "Not available"}
            </p>
            {order.stripeDashboardUrl ? (
              <a
                className="mt-3 inline-block text-sm font-medium text-ink-soft hover:text-brand"
                href={order.stripeDashboardUrl}
                rel="noreferrer"
                target="_blank"
              >
                View Stripe session
              </a>
            ) : null}
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
