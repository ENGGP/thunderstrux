import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { Suspense } from "react";
import { EventWorkspaceHeader } from "@/components/events/event-tabs";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { CommerceOrders } from "./commerce-orders";
import { DownloadCsv } from "@/components/orders/download-csv";
import { Pager } from "@/components/ui/pager";
import { Count, LinkTabs, pillBarClasses, pillClasses, rowLinkClasses } from "@/components/ui/link-tabs";
import { FilterBar } from "@/components/ui/filter-bar";
import { DateField } from "@/components/ui/date-field";
import { Select, TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { requireManagementPage } from "@/lib/auth/page-access";
import { readTimeZone } from "@/lib/organisations/profile";
import { dateFilterBound } from "@/lib/zoned-time";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  EventLifecycleNotFoundError,
  getDashboardEvent,
  listEventOptions
} from "@/lib/events/event-lifecycle";
import { formatDateTime, formatPrice, orderReference } from "@/lib/format";
import {
  OrganisationOrderEventAccessError,
  getGroupedOrganisationOrdersWithContext,
  orderStatusFilters,
  parseOrderStatusFilter,
  orderFilterLabels,
  systemOrderStatusFilters,
  ticketReviewCount,
  type OrderStatusFilter
} from "@/lib/orders/grouped-orders";
import {
  PaginationError,
  parsePaginationOptionsOrDefault
} from "@/lib/pagination/cursor";

export const metadata: Metadata = { title: "Orders" };

// The commerce list streams its status pills and filters with the rows, so its
// placeholder has all three and nothing pops in above the table.
function CommerceOrdersSkeleton() {
  return (
    <>
      <Skeleton className="h-10 w-full max-w-xl rounded-full" />
      <Skeleton className="h-36 rounded-card sm:h-28" />
      <ListSkeleton label="Loading orders" rows={6} />
    </>
  );
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
    family?: string;
    productId?: string;
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
  const params = await searchParams;
  const family = params.family === "memberships" || params.family === "merchandise" ? params.family : "tickets";
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
  } = params;
  const organisation = await requireManagementPage("orders:read", "/dashboard/orders");
  const includeSystemOrders = includeSystemParam === "true";
  const activeFilter = parseOrderStatusFilter(statusParam ?? null, {
    includeSystemOrders
  });
  const eventId = eventIdParam?.trim() || undefined;
  const search = searchParam?.trim() || undefined;
  const timeZone = await readTimeZone(organisation.id);
  const startDate = startDateParam ? dateFilterBound(startDateParam, timeZone) : undefined;
  const endDate = endDateParam ? dateFilterBound(endDateParam, timeZone, { endOfDay: true }) : undefined;
  const pagination = parsePaginationOptionsOrDefault(
    new URLSearchParams({
      ...(limitParam ? { limit: limitParam } : {}),
      ...(cursorParam ? { cursor: cursorParam } : {}),
      ...(directionParam ? { direction: directionParam } : {})
    })
  );

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

  // The count follows the event asked for, so another society's id counts nothing, as its list shows.
  const [eventOptions, reviewCount] = await Promise.all([
    listEventOptions(organisation.id, event?.id),
    family === "tickets"
      ? ticketReviewCount(organisation.id, eventId)
      : 0
  ]);

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
        <>
          <PageHeader description={`Everything bought from ${organisation.name}, newest first.`} title="Orders" />
          {/* Family tabs (T29b); an event's orders stay on its Tickets view. */}
          <LinkTabs
            label="Order types"
            tabs={(["tickets", "memberships", "merchandise"] as const).map((name) => ({
              href: name === "tickets" ? "/dashboard/orders" : `/dashboard/orders?family=${name}`,
              label: { tickets: "Tickets", memberships: "Memberships", merchandise: "Merchandise" }[name],
              active: name === family
            }))}
          />
        </>
      )}
      {family !== "tickets" && !event ? (
        <Suspense fallback={<CommerceOrdersSkeleton />}>
          <CommerceOrders organisationId={organisation.id} pagination={pagination} params={{ ...params, family }} />
        </Suspense>
      ) : (
      <>

      <nav aria-label="Order status" className={pillBarClasses}>
        {visibleStatusFilters.map((status) => (
          <Link
            aria-current={status === activeFilter ? "page" : undefined}
            className={pillClasses(status === activeFilter)}
            href={ordersHref({ status: status === "all" ? undefined : status })}
            key={status}
          >
            {orderFilterLabels[status]}
            {status === "review" && reviewCount ? <Count active={status === activeFilter} value={reviewCount} /> : null}
          </Link>
        ))}
      </nav>

      <FilterBar
        action="/dashboard/orders"
        active={[search, eventId, startDateParam, endDateParam].filter(Boolean).length}
        className="sm:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(11.5rem,1fr)_minmax(11.5rem,1fr)_auto]"
        label="Filter orders"
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
          label="Reference, name or email"
          name="search"
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
        <DateField defaultValue={startDateParam ?? ""} label="From" name="startDate" />
        <DateField defaultValue={endDateParam ?? ""} label="To" name="endDate" />
      </FilterBar>
      {/* Every order these filters match, not just this page (UI-018). */}
      <DownloadCsv href={ordersHref({}).replace("/dashboard/orders", "/api/orders/export")} />

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
          timeZone={timeZone}
          systemToggleHref={ordersHref({ status: undefined, includeSystem: includeSystemOrders ? undefined : "true" })}
        />
      </Suspense>
      </>
      )}
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
  systemToggleHref,
  timeZone
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
  // Times show in the society's zone, the same zone the date filters use.
  timeZone: string;
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

  type Row = (typeof orders)[number];
  // Order detail serves settled orders only, so a pending one is not a link. The
  // name leads, as on the other families' tabs, with the reference beneath (UI-066).
  const buyer = (order: Row) => {
    const name = order.buyerName ?? order.buyerEmail ?? "Unknown buyer";
    return order.status === "pending" ? (
      <span className="text-ink [overflow-wrap:anywhere]">{name}</span>
    ) : (
      <Link className={rowLinkClasses} href={`/dashboard/orders/${order.id}`}>
        {name}
      </Link>
    );
  };
  const reference = (order: Row) => `Order ${orderReference(order.id)}`;
  const status = (order: Row) => (
    <div className="grid gap-1">
      <StatusBadge status={order.projection} />
      {order.requiresCompensationReview ? <p className="max-w-56 text-sm font-medium text-warning">Payment received; fulfilment review required</p> : null}
      {/* Under Refunded, because the bank returned the money. */}
      {order.disputeStatus === "lost" ? <p className="max-w-56 text-sm text-ink-soft">Dispute lost: the bank returned the payment.</p> : null}
    </div>
  );

  return (
    <>
      {pagination.invalid ? (
        <Notice tone="warning">
          Invalid pagination parameters were ignored. Showing the first page.
        </Notice>
      ) : null}

      {orders.length === 0 ? (
        eventId && !orderResult.event ? (
          <div className="rounded-card border border-line bg-surface p-6 text-ink-soft">No orders found for this event.</div>
        ) : eventId || filters.search || startDateParam || endDateParam ? (
          <EmptyState
            action={<Link className="font-semibold text-brand underline underline-offset-4" href={`/dashboard/orders${activeFilter !== "all" ? `?status=${activeFilter}` : ""}`}>Clear filters</Link>}
            icon="search"
            title="No matching orders"
          >
            Nothing matches these filters. Clear them to see every order{activeFilter === "all" ? "" : ` under ${orderFilterLabels[activeFilter]}`}.
          </EmptyState>
        ) : (
          <div className="rounded-card border border-line bg-surface p-6 text-ink-soft">{activeFilter === "all" ? "No orders yet." : `No orders under ${orderFilterLabels[activeFilter]}.`}</div>
        )
      ) : (
        <ResponsiveTable
          card={(order) => (
            <>
              {/* The same card as the other families: buyer and total, then what and when, then status. */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">{buyer(order)}</div>
                <strong className="tabular-nums">{formatPrice(order.totalAmount)}</strong>
              </div>
              <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
                {reference(order)} · {order.eventTitle} · {order.quantity} × {order.ticketType} · {formatDateTime(order.createdAt, { timeZone })}
              </p>
              {status(order)}
            </>
          )}
          columns={[
            { header: "Buyer", cell: (order) => <>{buyer(order)}<p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{reference(order)}{order.buyerName && order.buyerEmail ? ` · ${order.buyerEmail}` : ""}</p></> },
            { header: "Event and ticket", cell: (order) => <><p className="text-ink [overflow-wrap:anywhere]">{order.eventTitle}</p><p className="text-sm text-ink-soft">{order.ticketType}</p></> },
            { header: "Qty", align: "right", cell: (order) => order.quantity },
            { header: "Total", align: "right", cell: (order) => formatPrice(order.totalAmount) },
            { header: "Status", cell: (order) => <>{status(order)}{order.failureReason ? <p className="mt-1 max-w-56 text-sm text-ink-soft">{order.failureReason}</p> : null}</> },
            { header: "Ordered", className: "whitespace-nowrap text-ink-soft", cell: (order) => formatDateTime(order.createdAt, { timeZone }) }
          ]}
          label="Ticket orders"
          rowKey={(order) => order.id}
          rows={orders}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link className="text-sm font-semibold text-brand underline underline-offset-4" href={systemToggleHref}>
          {includeSystemOrders ? "Hide system orders" : "Show system orders (pending checkouts)"}
        </Link>
        <Pager
          label="Order pagination"
          next={pageInfo.nextCursor && paginationHref(pageInfo.nextCursor, "next")}
          previous={pageInfo.previousCursor && paginationHref(pageInfo.previousCursor, "prev")}
        />
      </div>
    </>
  );
}
