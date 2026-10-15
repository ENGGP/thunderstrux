import Link from "next/link";
import { Suspense } from "react";
import { EventWorkspaceHeader, tabBarClasses, tabClasses } from "@/components/events/event-tabs";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Button, buttonClasses } from "@/components/ui/button";
import { Select, TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { ListSkeleton } from "@/components/ui/skeleton";
import { requireManagementPage } from "@/lib/auth/page-access";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  EventLifecycleNotFoundError,
  getDashboardEvent,
  listEventOptions
} from "@/lib/events/event-lifecycle";
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

type Filters = {
  includeSystemOrders: boolean;
  search?: string;
  startDate?: Date;
  endDate?: Date;
};

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
  const filters: Filters = {
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

  const eventOptions = await listEventOptions(organisation.id);

  if (event) {
    const { id, title } = event;
    if (!eventOptions.some((option) => option.id === id)) eventOptions.unshift({ id, title });
  }

  // Every filter link keeps the other filters.
  function ordersHref(changes: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const values: Record<string, string | undefined> = {
      status: activeFilter !== "all" ? activeFilter : undefined,
      eventId,
      includeSystem: includeSystemOrders ? "true" : undefined,
      search,
      startDate: startDateParam,
      endDate: endDateParam,
      ...changes
    };

    for (const [key, value] of Object.entries(values)) {
      if (value) params.set(key, value);
    }

    const query = params.toString();
    return query ? `/dashboard/orders?${query}` : "/dashboard/orders";
  }

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      {event ? (
        <EventWorkspaceHeader active="orders" event={event} staffRole={organisation.staffRole} />
      ) : (
        <PageHeader
          description={`Review ticket purchases and payment reconciliation for ${organisation.name}.`}
          title="Orders"
        />
      )}

      <nav aria-label="Order status" className={`max-w-full ${tabBarClasses}`}>
        {visibleStatusFilters.map((status) => (
          <Link
            aria-current={status === activeFilter ? "page" : undefined}
            className={tabClasses(status === activeFilter)}
            href={ordersHref({ status: status === "all" ? undefined : status })}
            key={status}
          >
            {filterLabel(status)}
          </Link>
        ))}
      </nav>

      <form
        action="/dashboard/orders"
        className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
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
        <TextInput
          defaultValue={search ?? ""}
          label="Buyer email"
          name="search"
          placeholder="Contains…"
          type="search"
        />
        <Select defaultValue={eventId ?? ""} label="Event" name="eventId">
          <option value="">All events</option>
          {eventOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
            </option>
          ))}
        </Select>
        <TextInput defaultValue={startDateParam ?? ""} label="From" name="startDate" type="date" />
        <TextInput defaultValue={endDateParam ?? ""} label="To" name="endDate" type="date" />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          <Link className={buttonClasses({ variant: "tertiary" })} href="/dashboard/orders">
            Clear
          </Link>
        </div>
      </form>

      <Suspense fallback={<ListSkeleton label="Loading orders" rows={6} />}>
        <OrderResults
          activeFilter={activeFilter}
          endDateParam={endDateParam}
          eventId={eventId}
          filters={filters}
          organisationId={organisation.id}
          pagination={pagination}
          startDateParam={startDateParam}
          includeSystemOrders={includeSystemOrders}
          systemToggleHref={ordersHref({ status: undefined, includeSystem: includeSystemOrders ? undefined : "true" })}
        />
      </Suspense>
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
  endDateParam,
  includeSystemOrders,
  systemToggleHref
}: {
  organisationId: string;
  activeFilter: OrderStatusFilter;
  eventId?: string;
  filters: Filters;
  pagination: ReturnType<typeof parsePaginationOptionsOrDefault>;
  startDateParam?: string;
  endDateParam?: string;
  includeSystemOrders: boolean;
  systemToggleHref: string;
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
  // The read groups a page by event; the table lists the page newest first.
  const orders = orderResult.groups
    .flatMap((group) => group.orders.map((order) => ({ ...order, eventTitle: group.eventTitle })))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
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

  const pageLink = buttonClasses({ variant: "secondary", size: "sm" });

  return (
    <>
      {pagination.invalid ? (
        <Notice tone="warning">
          Invalid pagination parameters were ignored. Showing the first page.
        </Notice>
      ) : null}

      {orders.length === 0 ? (
        <div className="rounded-card border border-line bg-surface p-6 text-ink-soft">
          {eventId && !orderResult.event
            ? "No orders found for this event."
            : `No ${activeFilter === "all" ? "" : `${activeFilter} `}orders yet.`}
        </div>
      ) : (
        <>
        <ul className="grid gap-3 md:hidden">
          {orders.map((order) => (
            <li className="grid gap-1.5 rounded-card border border-line bg-surface p-4" key={order.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {order.status === "pending" ? (
                    <p className="text-ink [overflow-wrap:anywhere]">{order.buyerEmail ?? "Unknown buyer"}</p>
                  ) : (
                    <Link className="font-semibold text-brand underline underline-offset-4 [overflow-wrap:anywhere]" href={`/dashboard/orders/${order.id}`}>
                      {order.buyerEmail ?? "Unknown buyer"}
                    </Link>
                  )}
                </div>
                <StatusBadge
                  label={order.isManuallyRefunded && order.projection === "paid" ? "Paid · refunded manually" : undefined}
                  status={order.projection}
                />
              </div>
              <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
                {order.eventTitle} · {order.ticketType}
              </p>
              <p className="text-sm tabular-nums text-ink">
                {order.quantity} {order.quantity === 1 ? "ticket" : "tickets"} · {formatMoney(order.totalAmount)} · {formatDateTime(order.createdAt)}
              </p>
              {order.isManuallyRefunded && order.status !== "paid" ? (
                <p className="text-sm text-ink-soft">Refunded manually</p>
              ) : null}
              {order.requiresCompensationReview ? (
                <p className="text-sm font-medium text-warning">Payment received; fulfilment review required</p>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
          <table className="w-full min-w-[820px] border-collapse text-left text-[15px]">
            <thead>
              <tr className="text-[13px] text-ink-soft">
                <th className="px-5 py-3.5 font-semibold" scope="col">Buyer</th>
                <th className="px-3 py-3.5 font-semibold" scope="col">Event and ticket</th>
                <th className="px-3 py-3.5 text-right font-semibold" scope="col">Qty</th>
                <th className="px-3 py-3.5 text-right font-semibold" scope="col">Total</th>
                <th className="px-3 py-3.5 font-semibold" scope="col">Status</th>
                <th className="px-5 py-3.5 font-semibold" scope="col">Ordered</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr className="border-t border-line align-top" key={order.id}>
                  <td className="px-5 py-3.5">
                    {/* Order detail serves settled orders only, so a pending one is not a link. */}
                    {order.status === "pending" ? (
                      <span className="text-ink">{order.buyerEmail ?? "Unknown buyer"}</span>
                    ) : (
                      <Link className="font-semibold text-brand underline underline-offset-4" href={`/dashboard/orders/${order.id}`}>
                        {order.buyerEmail ?? "Unknown buyer"}
                      </Link>
                    )}
                  </td>
                  <td className="px-3 py-3.5">
                    <p className="text-ink [overflow-wrap:anywhere]">{order.eventTitle}</p>
                    <p className="text-sm text-ink-soft">{order.ticketType}</p>
                  </td>
                  <td className="px-3 py-3.5 text-right tabular-nums">{order.quantity}</td>
                  <td className="px-3 py-3.5 text-right tabular-nums">{formatMoney(order.totalAmount)}</td>
                  <td className="px-3 py-3.5">
                    <StatusBadge
                      label={order.isManuallyRefunded && order.projection === "paid" ? "Paid · refunded manually" : undefined}
                      status={order.projection}
                    />
                    {order.isManuallyRefunded && order.status !== "paid" ? (
                      <p className="mt-1 text-sm text-ink-soft">Refunded manually</p>
                    ) : null}
                    {order.requiresCompensationReview ? (
                      <p className="mt-1 max-w-56 text-sm font-medium text-warning">
                        Payment received; fulfilment review required
                      </p>
                    ) : null}
                    {order.failureReason ? (
                      <p className="mt-1 max-w-56 text-sm text-ink-soft">{order.failureReason}</p>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-ink-soft">
                    {formatDateTime(order.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link className="text-sm font-semibold text-brand underline underline-offset-4" href={systemToggleHref}>
          {includeSystemOrders ? "Hide system orders" : "Show system orders (pending checkouts)"}
        </Link>
        {pageInfo.hasPreviousPage || pageInfo.hasNextPage ? (
          <nav aria-label="Order pagination" className="flex gap-2">
            {pageInfo.previousCursor ? (
              <Link className={pageLink} href={paginationHref(pageInfo.previousCursor, "prev")}>
                Previous
              </Link>
            ) : null}
            {pageInfo.nextCursor ? (
              <Link className={pageLink} href={paginationHref(pageInfo.nextCursor, "next")}>
                Next
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </>
  );
}
