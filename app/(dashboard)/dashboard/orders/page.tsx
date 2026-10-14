import Link from "next/link";
import { Suspense } from "react";
import { EventWorkspaceHeader } from "@/components/events/event-tabs";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { ListSkeleton } from "@/components/ui/skeleton";
import { requireManagementPage } from "@/lib/auth/page-access";
import { StatusBadge } from "@/components/ui/status-badge";
import { EventLifecycleNotFoundError, getDashboardEvent } from "@/lib/events/event-lifecycle";
import { formatDateTime, formatMoney } from "@/lib/format";
import {
  OrganisationOrderEventAccessError,
  getGroupedOrganisationOrdersWithContext,
  orderStatusFilters,
  parseOrderStatusFilter,
  systemOrderStatusFilters,
  type OrderStatusFilter
} from "@/lib/orders/grouped-orders";
import {
  PaginationError,
  parsePaginationOptionsOrDefault
} from "@/lib/pagination/cursor";

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
    limit?: string;
    cursor?: string;
    direction?: string;
  }>;
}) {
  const {
    status: statusParam,
    eventId: eventIdParam,
    includeSystem: includeSystemParam,
    search: searchParam,
    startDate: startDateParam,
    endDate: endDateParam,
    limit: limitParam,
    cursor: cursorParam,
    direction: directionParam
  } = await searchParams;
  const organisation = await requireManagementPage("orders:read", "/dashboard/orders");
  const includeSystemOrders = includeSystemParam === "true";
  const activeFilter = parseOrderStatusFilter(statusParam ?? null, {
    includeSystemOrders
  });
  const eventId = eventIdParam?.trim() || undefined;
  const search = searchParam?.trim() || undefined;
  const startDate = startDateParam ? new Date(startDateParam) : undefined;
  const endDate = endDateParam ? new Date(endDateParam) : undefined;
  const pagination = parsePaginationOptionsOrDefault(
    new URLSearchParams({
      ...(limitParam ? { limit: limitParam } : {}),
      ...(cursorParam ? { cursor: cursorParam } : {}),
      ...(directionParam ? { direction: directionParam } : {})
    })
  );

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
  const filters = {
    includeSystemOrders,
    search,
    startDate: startDate && !Number.isNaN(startDate.getTime()) ? startDate : undefined,
    endDate: endDate && !Number.isNaN(endDate.getTime()) ? endDate : undefined
  };
  // Decided before streaming: an event of this society gets its workspace header.
  let event: Awaited<ReturnType<typeof getDashboardEvent>> | null = null;

  if (eventId) {
    try {
      event = await getDashboardEvent(organisation.id, eventId);
    } catch (error) {
      if (!(error instanceof EventLifecycleNotFoundError)) throw error;
    }
  }

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <div className="mx-auto grid max-w-admin grid-cols-1 gap-6 px-4 py-8 sm:px-8">
        {event ? (
          <EventWorkspaceHeader active="orders" event={event} staffRole={organisation.staffRole} />
        ) : (
          <PageHeader
            description={`Review ticket purchases and payment reconciliation for ${organisation.name}.`}
            title="Orders"
          />
        )}

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
                className={`rounded-control border px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? "border-brand bg-brand text-white"
                    : "border-line bg-surface text-ink-soft hover:border-line-strong"
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
                className={`rounded-control border px-3 py-2 text-sm font-medium transition ${
                  includeSystemOrders
                    ? "border-warning bg-warning-bg text-warning"
                    : "border-line bg-surface text-ink-soft hover:border-line-strong"
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
          className="grid gap-4 rounded-card border border-line bg-surface p-5 md:grid-cols-4"
        >
          {activeFilter !== "all" ? (
            <input name="status" type="hidden" value={activeFilter} />
          ) : null}
          {includeSystemOrders ? (
            <input name="includeSystem" type="hidden" value="true" />
          ) : null}
          {pagination.limit !== 25 ? (
            <input name="limit" type="hidden" value={pagination.limit} />
          ) : null}
          <label className="grid gap-2 text-sm font-medium text-ink-soft">
            <span>Buyer email</span>
            <input
              className="h-10 rounded-control border border-line-strong bg-surface px-3 text-sm"
              defaultValue={search ?? ""}
              name="search"
              placeholder="name@example.com"
              type="search"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-ink-soft">
            <span>Event ID</span>
            <input
              className="h-10 rounded-control border border-line-strong bg-surface px-3 text-sm"
              defaultValue={eventId ?? ""}
              name="eventId"
              placeholder="event id"
              type="text"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-ink-soft">
            <span>From</span>
            <input
              className="h-10 rounded-control border border-line-strong bg-surface px-3 text-sm"
              defaultValue={startDateParam ?? ""}
              name="startDate"
              type="date"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-ink-soft">
            <span>To</span>
            <input
              className="h-10 rounded-control border border-line-strong bg-surface px-3 text-sm"
              defaultValue={endDateParam ?? ""}
              name="endDate"
              type="date"
            />
          </label>
          <div className="flex flex-wrap gap-3 md:col-span-4">
            <button
              className="inline-flex h-10 items-center justify-center rounded-control bg-brand px-4 text-sm font-medium text-white transition hover:bg-brand-hover"
              type="submit"
            >
              Apply filters
            </button>
            <Link
              className="inline-flex h-10 items-center justify-center rounded-control border border-line-strong bg-surface px-4 text-sm font-medium text-ink transition hover:bg-surface-subtle"
              href="/dashboard/orders"
            >
              Clear
            </Link>
          </div>
        </form>

        <Suspense fallback={<ListSkeleton label="Loading orders" />}>
          <OrderResults
            activeFilter={activeFilter}
            endDateParam={endDateParam}
            eventId={eventId}
            filters={filters}
            organisationId={organisation.id}
            pagination={pagination}
            startDateParam={startDateParam}
          />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

async function OrderResults({
  organisationId,
  activeFilter,
  eventId,
  filters,
  pagination: initialPagination,
  startDateParam,
  endDateParam
}: {
  organisationId: string;
  activeFilter: OrderStatusFilter;
  eventId?: string;
  filters: {
    includeSystemOrders: boolean;
    search?: string;
    startDate?: Date;
    endDate?: Date;
  };
  pagination: ReturnType<typeof parsePaginationOptionsOrDefault>;
  startDateParam?: string;
  endDateParam?: string;
}) {
  let pagination = initialPagination;
  let orderResult: Awaited<ReturnType<typeof getGroupedOrganisationOrdersWithContext>>;

  try {
    orderResult = await getGroupedOrganisationOrdersWithContext(
      organisationId,
      activeFilter,
      eventId,
      {
        ...filters,
        limit: pagination.limit,
        cursor: pagination.cursor,
        direction: pagination.direction
      }
    );
  } catch (error) {
    if (error instanceof OrganisationOrderEventAccessError) {
      orderResult = {
        event: null,
        groups: [],
        pageInfo: {
          limit: pagination.limit,
          hasNextPage: false,
          hasPreviousPage: false,
          nextCursor: null,
          previousCursor: null
        }
      };
    } else if (error instanceof PaginationError) {
      pagination = {
        limit: 25,
        direction: "next",
        invalid: true
      };
      orderResult = await getGroupedOrganisationOrdersWithContext(
        organisationId,
        activeFilter,
        eventId,
        {
          ...filters,
          limit: pagination.limit,
          direction: pagination.direction
        }
      );
    } else {
      throw error;
    }
  }
  const groupedOrders = orderResult.groups;
  const pageInfo = orderResult.pageInfo;
  const paginationBaseParams = new URLSearchParams();

  if (activeFilter !== "all") {
    paginationBaseParams.set("status", activeFilter);
  }

  if (eventId) {
    paginationBaseParams.set("eventId", eventId);
  }

  if (filters.includeSystemOrders) {
    paginationBaseParams.set("includeSystem", "true");
  }

  if (filters.search) {
    paginationBaseParams.set("search", filters.search);
  }

  if (startDateParam) {
    paginationBaseParams.set("startDate", startDateParam);
  }

  if (endDateParam) {
    paginationBaseParams.set("endDate", endDateParam);
  }

  if (pageInfo.limit !== 25) {
    paginationBaseParams.set("limit", String(pageInfo.limit));
  }

  function paginationHref(cursor: string, direction: "next" | "prev") {
    const params = new URLSearchParams(paginationBaseParams);
    params.set("cursor", cursor);
    params.set("direction", direction);
    return `/dashboard/orders?${params.toString()}`;
  }

  return (
    <>
      {pagination.invalid ? (
        <section className="rounded-card border border-warning bg-warning-bg p-4 text-sm text-warning">
          Invalid pagination parameters were ignored. Showing the first page.
        </section>
      ) : null}

      <section className="space-y-5">
        {groupedOrders.length === 0 ? (
          <div className="rounded-card border border-line bg-surface p-6">
            <p className="text-sm text-ink-muted">
              {eventId && !orderResult.event
                ? "No orders found for this event."
                : `No ${
                    activeFilter === "all" ? "" : `${activeFilter} `
                  }orders yet.`}
            </p>
          </div>
        ) : (
          groupedOrders.map((group) => (
            <article
              className="rounded-card border border-line bg-surface p-6"
              key={group.eventId}
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-ink">
                  {group.eventTitle}
                </h2>
                <p className="text-sm text-ink-muted">
                  {group.orders.length} order
                  {group.orders.length === 1 ? "" : "s"}
                  {" "}on this page
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-ink-muted">
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
                        className="border-b border-line last:border-0"
                        key={order.id}
                      >
                        <td className="py-3 pr-4 text-ink-soft">
                          {order.buyerEmail ?? "Unknown buyer"}
                        </td>
                        <td className="py-3 pr-4 text-ink-soft">
                          {order.ticketType}
                        </td>
                        <td className="py-3 pr-4 text-ink-soft">
                          {order.quantity}
                        </td>
                        <td className="py-3 pr-4 text-ink-soft">
                          {formatMoney(order.totalAmount)}
                        </td>
                        <td className="py-3 pr-4 text-ink-soft">
                          <StatusBadge status={order.status} />
                          {order.isManuallyRefunded ? (
                            <p className="mt-1 text-xs text-warning">
                              Manual refund
                            </p>
                          ) : null}
                          {order.requiresCompensationReview ? (
                            <p className="mt-1 max-w-56 text-xs font-medium text-warning">
                              Payment received; fulfilment review required
                            </p>
                          ) : null}
                          {order.failureReason ? (
                            <p className="mt-1 max-w-56 text-xs text-danger">
                              {order.failureReason}
                            </p>
                          ) : null}
                        </td>
                        <td className="py-3 pr-4 text-ink-soft">
                          {formatDateTime(
                            order.paidAt ?? order.failedAt ?? order.createdAt
                          )}
                        </td>
                        <td className="py-3">
                          <Link
                            className="text-sm font-medium text-ink-soft hover:text-brand"
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

      {pageInfo.hasPreviousPage || pageInfo.hasNextPage ? (
        <nav
          aria-label="Order pagination"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          {pageInfo.previousCursor ? (
            <Link
              className="inline-flex h-10 items-center justify-center rounded-control border border-line-strong bg-surface px-4 text-sm font-medium text-ink transition hover:bg-surface-subtle"
              href={paginationHref(pageInfo.previousCursor, "prev")}
            >
              Previous
            </Link>
          ) : (
            <span />
          )}
          {pageInfo.nextCursor ? (
            <Link
              className="inline-flex h-10 items-center justify-center rounded-control border border-line-strong bg-surface px-4 text-sm font-medium text-ink transition hover:bg-surface-subtle"
              href={paginationHref(pageInfo.nextCursor, "next")}
            >
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
