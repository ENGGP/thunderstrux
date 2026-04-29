import Link from "next/link";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import {
  requireCurrentOrganisationAccount,
  requireOrganisationFinanceAccess
} from "@/lib/auth/access";
import {
  getGroupedOrganisationOrders,
  orderStatusFilters,
  parseOrderStatusFilter,
  type OrderStatusFilter
} from "@/lib/orders/grouped-orders";

function formatCurrency(amountInCents: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "AUD"
  }).format(amountInCents / 100);
}

function formatDateTime(value: Date | null) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(value);
}

function statusLabel(status: "pending" | "paid" | "failed" | "expired") {
  if (status === "paid") {
    return "Paid";
  }

  if (status === "failed") {
    return "Failed";
  }

  if (status === "expired") {
    return "Expired";
  }

  return "Pending";
}

function filterLabel(status: OrderStatusFilter) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default async function OrganisationOrdersPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusParam } = await searchParams;
  const organisation = await requireCurrentOrganisationAccount();
  await requireOrganisationFinanceAccess(organisation.id);
  const activeFilter = parseOrderStatusFilter(statusParam ?? null);
  const groupedOrders = await getGroupedOrganisationOrders(
    organisation.id,
    activeFilter
  );

  return (
    <DashboardShell basePath="/dashboard" orgName={organisation.name}>
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <header className="space-y-2">
          <h2 className="text-3xl font-semibold text-neutral-950">Orders</h2>
          <p className="text-sm text-neutral-600">
            Review ticket purchases and payment reconciliation for {organisation.name}.
          </p>
        </header>

        <nav className="flex flex-wrap gap-2" aria-label="Order status filters">
          {orderStatusFilters.map((status) => {
            const isActive = status === activeFilter;
            const href =
              status === "all" ? "/dashboard/orders" : `/dashboard/orders?status=${status}`;

            return (
              <Link
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
                }`}
                href={href}
                key={status}
              >
                {filterLabel(status)}
              </Link>
            );
          })}
        </nav>

        <section className="space-y-5">
          {groupedOrders.length === 0 ? (
            <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-neutral-600">
                No {activeFilter === "all" ? "" : `${activeFilter} `}orders have
                been placed yet.
              </p>
            </div>
          ) : (
            groupedOrders.map((group) => (
              <article
                className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm"
                key={group.eventId}
              >
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold text-neutral-950">
                    {group.eventTitle}
                  </h3>
                  <p className="text-sm text-neutral-500">
                    {group.orders.length} order
                    {group.orders.length === 1 ? "" : "s"}
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-neutral-200 text-neutral-500">
                        <th className="py-3 pr-4 font-medium">Buyer</th>
                        <th className="py-3 pr-4 font-medium">Ticket</th>
                        <th className="py-3 pr-4 font-medium">Quantity</th>
                        <th className="py-3 pr-4 font-medium">Total</th>
                        <th className="py-3 pr-4 font-medium">Status</th>
                        <th className="py-3 font-medium">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.orders.map((order) => (
                        <tr
                          className="border-b border-neutral-100 last:border-0"
                          key={order.id}
                        >
                          <td className="py-3 pr-4 text-neutral-700">
                            {order.buyerEmail ?? "Unknown buyer"}
                          </td>
                          <td className="py-3 pr-4 text-neutral-700">
                            {order.ticketType}
                          </td>
                          <td className="py-3 pr-4 text-neutral-700">
                            {order.quantity}
                          </td>
                          <td className="py-3 pr-4 text-neutral-700">
                            {formatCurrency(order.totalAmount)}
                          </td>
                          <td className="py-3 pr-4 text-neutral-700">
                            {statusLabel(order.status)}
                            {order.failureReason ? (
                              <p className="mt-1 max-w-56 text-xs text-red-700">
                                {order.failureReason}
                              </p>
                            ) : null}
                          </td>
                          <td className="py-3 text-neutral-700">
                            {formatDateTime(
                              order.paidAt ?? order.failedAt ?? order.createdAt
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
