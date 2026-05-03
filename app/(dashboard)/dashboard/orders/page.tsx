import Link from "next/link";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import {
  requireCurrentOrganisationAccount,
  requireOrganisationFinanceAccess
} from "@/lib/auth/access";
import {
  OrganisationOrderEventAccessError,
  getGroupedOrganisationOrdersWithContext,
  orderStatusFilters,
  parseOrderStatusFilter,
  systemOrderStatusFilters,
  type OrderStatusFilter
} from "@/lib/orders/grouped-orders";

function formatCurrency(amountInCents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD"
  }).format(amountInCents / 100);
}

function formatDateTime(value: Date | null) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Brisbane"
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
  searchParams: Promise<{
    status?: string;
    eventId?: string;
    includeSystem?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
  }>;
}) {
  const {
    status: statusParam,
    eventId: eventIdParam,
    includeSystem: includeSystemParam,
    search: searchParam,
    startDate: startDateParam,
    endDate: endDateParam
  } = await searchParams;
  const organisation = await requireCurrentOrganisationAccount();
  await requireOrganisationFinanceAccess(organisation.id);
  const includeSystemOrders = includeSystemParam === "true";
  const activeFilter = parseOrderStatusFilter(statusParam ?? null, {
    includeSystemOrders
  });
  const eventId = eventIdParam?.trim() || undefined;
  const search = searchParam?.trim() || undefined;
  const startDate = startDateParam ? new Date(startDateParam) : undefined;
  const endDate = endDateParam ? new Date(endDateParam) : undefined;

  if (
    endDate &&
    !Number.isNaN(endDate.getTime()) &&
    endDateParam &&
    /^\d{4}-\d{2}-\d{2}$/.test(endDateParam)
  ) {
    endDate.setUTCHours(23, 59, 59, 999);
  }
  const visibleStatusFilters = includeSystemOrders
    ? systemOrderStatusFilters
    : orderStatusFilters;
  let orderResult: Awaited<ReturnType<typeof getGroupedOrganisationOrdersWithContext>>;

  try {
    orderResult = await getGroupedOrganisationOrdersWithContext(
      organisation.id,
      activeFilter,
      eventId,
      {
        includeSystemOrders,
        search,
        startDate:
          startDate && !Number.isNaN(startDate.getTime()) ? startDate : undefined,
        endDate: endDate && !Number.isNaN(endDate.getTime()) ? endDate : undefined
      }
    );
  } catch (error) {
    if (error instanceof OrganisationOrderEventAccessError) {
      orderResult = { event: null, groups: [] };
    } else {
      throw error;
    }
  }
  const groupedOrders = orderResult.groups;
  const eventFilter = orderResult.event;

  return (
    <DashboardShell basePath="/dashboard" orgName={organisation.name}>
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <header className="space-y-2">
          <h2 className="text-3xl font-semibold text-neutral-950">Orders</h2>
          <p className="text-sm text-neutral-600">
            Review ticket purchases and payment reconciliation for {organisation.name}.
          </p>
        </header>

        {eventFilter ? (
          <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-neutral-500">Filtered by event</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-xl font-semibold text-neutral-950">
                {eventFilter.title}
              </h3>
              <Link
                className="text-sm font-medium text-neutral-700 hover:text-neutral-950"
                href="/dashboard/orders"
              >
                Back to all orders
              </Link>
            </div>
          </section>
        ) : null}

        <nav className="flex flex-wrap gap-2" aria-label="Order status filters">
          {visibleStatusFilters.map((status) => {
            const isActive = status === activeFilter;
            const params = new URLSearchParams();

            if (status !== "all") {
              params.set("status", status);
            }

            if (eventId) {
              params.set("eventId", eventId);
            }

            if (includeSystemOrders) {
              params.set("includeSystem", "true");
            }

            if (search) {
              params.set("search", search);
            }

            if (startDateParam) {
              params.set("startDate", startDateParam);
            }

            if (endDateParam) {
              params.set("endDate", endDateParam);
            }

            const query = params.toString();
            const href = query ? `/dashboard/orders?${query}` : "/dashboard/orders";

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
          {(() => {
            const params = new URLSearchParams();

            if (eventId) {
              params.set("eventId", eventId);
            }

            if (search) {
              params.set("search", search);
            }

            if (startDateParam) {
              params.set("startDate", startDateParam);
            }

            if (endDateParam) {
              params.set("endDate", endDateParam);
            }

            if (!includeSystemOrders) {
              params.set("includeSystem", "true");
            }

            const query = params.toString();
            const href = query ? `/dashboard/orders?${query}` : "/dashboard/orders";

            return (
              <Link
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  includeSystemOrders
                    ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                    : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
                }`}
                href={href}
              >
                {includeSystemOrders
                  ? "Hide system orders"
                  : "Show system orders"}
              </Link>
            );
          })()}
        </nav>

        <form
          action="/dashboard/orders"
          className="grid gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm md:grid-cols-4"
        >
          {activeFilter !== "all" ? (
            <input name="status" type="hidden" value={activeFilter} />
          ) : null}
          {includeSystemOrders ? (
            <input name="includeSystem" type="hidden" value="true" />
          ) : null}
          <label className="grid gap-2 text-sm font-medium text-neutral-800">
            <span>Buyer email</span>
            <input
              className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-neutral-900"
              defaultValue={search ?? ""}
              name="search"
              placeholder="name@example.com"
              type="search"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-neutral-800">
            <span>Event ID</span>
            <input
              className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-neutral-900"
              defaultValue={eventId ?? ""}
              name="eventId"
              placeholder="event id"
              type="text"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-neutral-800">
            <span>From</span>
            <input
              className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-neutral-900"
              defaultValue={startDateParam ?? ""}
              name="startDate"
              type="date"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-neutral-800">
            <span>To</span>
            <input
              className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-neutral-900"
              defaultValue={endDateParam ?? ""}
              name="endDate"
              type="date"
            />
          </label>
          <div className="flex flex-wrap gap-3 md:col-span-4">
            <button
              className="inline-flex h-10 items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white transition hover:bg-neutral-700"
              type="submit"
            >
              Apply filters
            </button>
            <Link
              className="inline-flex h-10 items-center justify-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-900 transition hover:bg-neutral-50"
              href="/dashboard/orders"
            >
              Clear
            </Link>
          </div>
        </form>

        <section className="space-y-5">
          {groupedOrders.length === 0 ? (
            <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-neutral-600">
                {eventId && !eventFilter
                  ? "No orders found for this event."
                  : `No ${
                      activeFilter === "all" ? "" : `${activeFilter} `
                    }orders yet.`}
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
                        <th className="py-3 pr-4 font-medium">Time</th>
                        <th className="py-3 font-medium">Details</th>
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
                            {order.isManuallyRefunded ? (
                              <p className="mt-1 text-xs text-amber-700">
                                Manual refund
                              </p>
                            ) : null}
                            {order.failureReason ? (
                              <p className="mt-1 max-w-56 text-xs text-red-700">
                                {order.failureReason}
                              </p>
                            ) : null}
                          </td>
                          <td className="py-3 pr-4 text-neutral-700">
                            {formatDateTime(
                              order.paidAt ?? order.failedAt ?? order.createdAt
                            )}
                          </td>
                          <td className="py-3">
                            <Link
                              className="text-sm font-medium text-neutral-700 hover:text-neutral-950"
                              href={`/dashboard/orders/${order.id}`}
                            >
                              View
                            </Link>
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
