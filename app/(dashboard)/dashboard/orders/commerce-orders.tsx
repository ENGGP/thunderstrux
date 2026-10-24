import Link from "next/link";
import type { CommerceKind } from "@prisma/client";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { pillBarClasses, pillClasses } from "@/components/ui/link-tabs";
import { DateField } from "@/components/ui/date-field";
import { Select, TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { commerceOrderFilters, commerceProductOptions, listOrganisationCommerceOrders, type CommerceOrderFilter } from "@/lib/commerce/orders";
import { formatDateTime, formatPrice, formatTerm } from "@/lib/format";
import { PaginationError, type ParsedPaginationOptions } from "@/lib/pagination/cursor";
import { readTimeZone } from "@/lib/organisations/profile";
import { orderReference } from "@/lib/payments/order-refunds";
import { ticketOrderProjection } from "@/lib/purchases/projection";

const filterLabels: Record<CommerceOrderFilter, string> = { all: "All", paid: "Paid", free: "Free", refunded: "Refunded", review: "Payment review", expired: "Expired" };
const pickupBadge = { pending: "preparing", ready: "ready-to-collect", collected: "collected" } as const;

type Order = Awaited<ReturnType<typeof listOrganisationCommerceOrders>>["items"][number];
type Params = { family: "memberships" | "merchandise"; status?: string; search?: string; productId?: string; startDate?: string; endDate?: string };

// The Memberships and Merchandise tabs of Orders (T29b, design round B2,
// OrdersB2): status pills, buyer email, plan or product and dates, then a
// table or cards. Money shows here because the page needs orders:read.
export async function CommerceOrders({
  organisationId,
  params,
  pagination: initial
}: {
  organisationId: string;
  params: Params;
  pagination: ParsedPaginationOptions & { invalid?: boolean };
}) {
  const timeZone = await readTimeZone(organisationId);
  const kind: CommerceKind = params.family === "memberships" ? "membership" : "merchandise";
  const filter = commerceOrderFilters.find((name) => name === params.status) ?? "all";
  const search = params.search?.trim().slice(0, 200) || undefined;
  const date = (value: string | undefined, end: boolean) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const parsed = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  };
  const options = { filter, search, productId: params.productId || undefined, startDate: date(params.startDate, false), endDate: date(params.endDate, true) };
  let pagination = initial;
  let result: Awaited<ReturnType<typeof listOrganisationCommerceOrders>>;
  try {
    result = await listOrganisationCommerceOrders(organisationId, kind, options, pagination);
  } catch (error) {
    if (!(error instanceof PaginationError)) throw error;
    pagination = { limit: 25, direction: "next", invalid: true };
    result = await listOrganisationCommerceOrders(organisationId, kind, options, pagination);
  }
  const products = await commerceProductOptions(organisationId, kind);
  const { items: orders, pageInfo } = result;

  const href = (changes: Record<string, string | undefined>) => {
    const values: Record<string, string | undefined> = {
      family: params.family, status: filter !== "all" ? filter : undefined, search, productId: params.productId, startDate: params.startDate, endDate: params.endDate,
      ...(pageInfo.limit !== 25 ? { limit: String(pageInfo.limit) } : {}), ...changes
    };
    const query = new URLSearchParams(Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
    return `/dashboard/orders?${query}`;
  };
  const merchandise = kind === "merchandise";
  // A merchandise order opens its staff page; a membership opens the member's page once granted.
  const detail = (order: Order) =>
    merchandise
      ? `/dashboard/merchandise/orders/${order.id}`
      : order.lines[0]?.membershipGrant
        ? `/dashboard/memberships/members/${order.lines[0].membershipGrant.id}`
        : null;
  const buyer = (order: Order) => {
    const name = order.buyerNameSnapshot || order.buyerEmailSnapshot;
    const link = detail(order);
    return link ? (
      <Link className="font-semibold text-brand underline underline-offset-4 [overflow-wrap:anywhere]" href={link}>
        {name}
      </Link>
    ) : (
      <span className="text-ink [overflow-wrap:anywhere]">{name}</span>
    );
  };
  const items = (order: Order) => {
    const [first, ...rest] = order.lines;
    if (!first) return "No items";
    if (!merchandise) return first.nameSnapshot;
    if (rest.length) return `${first.nameSnapshot} and ${rest.length} more`;
    return `${first.quantity > 1 ? `${first.quantity} × ` : ""}${first.nameSnapshot}${first.variantSnapshot ? ` · ${first.variantSnapshot}` : ""}`;
  };
  const term = (order: Order) => {
    const line = order.lines[0];
    return line?.termStartsAt && line.termEndsAt ? formatTerm(line.termStartsAt, line.termEndsAt, timeZone) : "";
  };
  const reference = (order: Order) => `${order.guestIdentityId ? "Guest · " : ""}Order ${orderReference(order.id)}`;
  const payment = (order: Order) => <StatusBadge status={ticketOrderProjection(order)} />;
  const pickup = (order: Order) =>
    order.requiresCompensationReview ? (
      <span className="text-sm text-ink-soft">On hold</span>
    ) : order.pickupStatus && (order.pickupStatus === "collected" || !(order.refundStatus || order.cancelledAt)) ? (
      <StatusBadge status={pickupBadge[order.pickupStatus]} />
    ) : (
      <span className="text-sm text-ink-soft">{order.pickupStatus ? "Not collected" : "No pickup"}</span>
    );
  const pageLink = buttonClasses({ variant: "secondary", size: "sm" });

  return (
    <>
      <nav aria-label={`${merchandise ? "Merchandise" : "Membership"} order status`} className={pillBarClasses}>
        {commerceOrderFilters.map((name) => (
          <Link
            aria-current={name === filter ? "page" : undefined}
            className={pillClasses(name === filter)}
            href={href({ status: name === "all" ? undefined : name, cursor: undefined })}
            key={name}
          >
            {filterLabels[name]}
          </Link>
        ))}
      </nav>
      <FilterBar action="/dashboard/orders" className="sm:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(11.5rem,1fr)_minmax(11.5rem,1fr)_auto]" label="Filter orders">
        <input name="family" type="hidden" value={params.family} />
        {filter !== "all" ? <input name="status" type="hidden" value={filter} /> : null}
        <TextInput defaultValue={search ?? ""} label="Buyer email" name="search" placeholder="Contains…" type="search" />
        <Select defaultValue={params.productId ?? ""} label={merchandise ? "Product" : "Plan"} name="productId">
          <option value="">{merchandise ? "All products" : "All plans"}</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </Select>
        <DateField defaultValue={params.startDate ?? ""} label="From" name="startDate" />
        <DateField defaultValue={params.endDate ?? ""} label="To" name="endDate" />
      </FilterBar>
      {pagination.invalid ? <Notice tone="warning">Invalid pagination parameters were ignored. Showing the first page.</Notice> : null}
      {orders.length === 0 ? (
        <EmptyState icon={merchandise ? "bag" : "receipt"} title={`No ${filter === "all" ? "" : `${filterLabels[filter].toLowerCase()} `}${merchandise ? "merchandise" : "membership"} orders`}>
          {search || params.productId || params.startDate || params.endDate ? "Nothing matches these filters. Clear them to see every order." : merchandise ? "Orders show here once buyers check out." : "Orders show here once members buy a membership or get a free one."}
        </EmptyState>
      ) : (
        <ResponsiveTable
          card={(order) => (
            <>
              <div className="flex items-start justify-between gap-3">
                {buyer(order)}
                <strong className="tabular-nums">{formatPrice(order.totalAmount)}</strong>
              </div>
              <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
                {reference(order)} · {merchandise ? items(order) : `${items(order)} · ${term(order)}`} · {formatDateTime(order.createdAt, { timeZone })}
              </p>
              <div className="flex flex-wrap gap-2">
                {payment(order)}
                {merchandise ? pickup(order) : null}
              </div>
            </>
          )}
          columns={[
            { header: "Buyer", cell: (order) => <>{buyer(order)}<p className="text-sm text-ink-soft">{reference(order)}</p></> },
            {
              header: merchandise ? "Items" : "Plan",
              cell: (order) => {
                const count = order.lines.reduce((total, line) => total + line.quantity, 0);
                const sub = merchandise ? (order.lines.length > 1 ? `${count} items` : "") : term(order);
                return <>{items(order)}{sub ? <p className="text-sm text-ink-soft">{sub}</p> : null}</>;
              }
            },
            { header: "Total", align: "right", cell: (order) => formatPrice(order.totalAmount) },
            { header: "Payment", cell: payment },
            ...(merchandise ? [{ header: "Pickup", cell: pickup }] : []),
            { header: "Ordered", className: "whitespace-nowrap text-sm text-ink-soft", cell: (order: Order) => formatDateTime(order.createdAt, { timeZone }) }
          ]}
          label={`${merchandise ? "Merchandise" : "Membership"} orders`}
          rowKey={(order) => order.id}
          rows={orders}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-ink-soft">Newest first. Each tab keeps its own filters.</p>
        {pageInfo.previousCursor || pageInfo.nextCursor ? (
          <nav aria-label="Order pagination" className="flex gap-2">
            {pageInfo.previousCursor ? <Link className={pageLink} href={href({ cursor: pageInfo.previousCursor, direction: "prev" })}>Previous</Link> : null}
            {pageInfo.nextCursor ? <Link className={pageLink} href={href({ cursor: pageInfo.nextCursor, direction: "next" })}>Next page</Link> : null}
          </nav>
        ) : null}
      </div>
      <section aria-labelledby="who-sees" className="grid gap-1.5 rounded-card border border-line bg-surface-subtle p-5">
        <h2 className="font-semibold text-ink" id="who-sees">
          Who sees what
        </h2>
        <p className="text-sm text-ink-soft">
          Totals and refunds show to owners, admins and finance managers. Staff who only hand out merchandise use Merchandise › Pickups, which shows items and buyer names but no money.
        </p>
      </section>
    </>
  );
}
