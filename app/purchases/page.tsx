import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PersonalShell } from "@/components/layout/personal-shell";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkTabs } from "@/components/ui/link-tabs";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/auth/access";
import { getOwnCommerceOrders } from "@/lib/commerce/orders";
import { formatDateTime, formatPrice, formatTerm } from "@/lib/format";
import { PaginationError, parsePaginationOptionsOrDefault, type ParsedPaginationOptions } from "@/lib/pagination/cursor";
import { orderReference } from "@/lib/payments/order-refunds";
import { buyerPurchaseBadge, purchasedTicketTypeLabel, ticketOrderProjection } from "@/lib/purchases/projection";
import { getOwnTicketPurchases, ownPurchaseCounts } from "@/lib/purchases/ticket-purchases";

export const metadata: Metadata = { title: "Purchases" };

const families = ["tickets", "memberships", "merchandise"] as const;
type Family = (typeof families)[number];
const familyLabels: Record<Family, string> = { tickets: "Tickets", memberships: "Memberships", merchandise: "Merchandise" };
const pickupBadge = { pending: "preparing", ready: "ready-to-collect", collected: "collected" } as const;

type Payable = Parameters<typeof ticketOrderProjection>[0] & { paymentKind: "free" | "stripe" | "legacy"; totalAmount: number };
type CommerceRow = Awaited<ReturnType<typeof getOwnCommerceOrders>>["items"][number];

// What the buyer paid, in the words that fit the order's state.
function PurchaseTotal({ order }: { order: Payable }) {
  const projection = ticketOrderProjection(order);
  if (projection === "failed" || projection === "expired") return <span className="text-ink-soft">Not charged</span>;
  if (order.paymentKind === "free") return <span>Free</span>;
  if (projection === "refunded") return <s className="text-ink-muted">{formatPrice(order.totalAmount)}</s>;
  return <span>{formatPrice(order.totalAmount)}</span>;
}

const rowLink = "font-semibold text-brand underline-offset-4 hover:underline [overflow-wrap:anywhere]";

// One purchase row: the name, a line under it, then the family's columns (T29a).
function Row({ href, title, detail, columns, date, total, grid }: { href: string; title: string; detail: string; columns: ReactNode[]; date: Date; total: ReactNode; grid: string }) {
  return (
    <li className={`grid gap-1.5 border-t border-line px-4 py-3.5 first:border-t-0 md:items-center md:gap-4 md:px-5 md:first:border-t ${grid}`}>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <Link className={rowLink} href={href}>
            {title}
          </Link>
          <span className="tabular-nums md:hidden">{total}</span>
        </div>
        <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
          {detail}
          <span className="md:hidden"> · {formatDateTime(date)}</span>
        </p>
      </div>
      {columns.map((column, index) => (
        <span className="flex flex-wrap gap-2" key={index}>
          {column}
        </span>
      ))}
      <span className="hidden tabular-nums md:block">{total}</span>
      <span className="hidden text-sm text-ink-soft md:block">{formatDateTime(date)}</span>
    </li>
  );
}

function Table({ label, grid, headings, children }: { label: string; grid: string; headings: string[]; children: ReactNode }) {
  return (
    <section aria-label={label} className="overflow-hidden rounded-card border border-line bg-surface">
      <div className={`hidden gap-4 bg-surface-subtle px-5 py-2.5 text-caption font-semibold text-ink-muted md:grid ${grid}`}>
        {headings.map((heading) => (
          <span key={heading}>{heading}</span>
        ))}
      </div>
      <ul>{children}</ul>
    </section>
  );
}

// A commerce order's payment badge, in the buyer's words (shared with tickets).
function PaymentBadge({ order }: { order: CommerceRow }) {
  const badge = buyerPurchaseBadge(order);
  return <StatusBadge label={badge.label} status={badge.status} />;
}

// The pickup of a merchandise order: a separate badge from payment.
function Pickup({ order }: { order: CommerceRow }) {
  if (order.pickupStatus && !(order.refundStatus === "refunded" || order.cancelledAt)) return <StatusBadge status={pickupBadge[order.pickupStatus]} />;
  if (order.pickupStatus === "collected") return <StatusBadge status="collected" />;
  return <span className="text-sm text-ink-soft">{order.pickupStatus ? "Not collected" : "No pickup"}</span>;
}

const summary = (order: CommerceRow) => {
  const [first, ...rest] = order.lines;
  if (!first) return "Order";
  return rest.length ? `${first.nameSnapshot} and ${rest.length} more` : first.quantity > 1 ? `${first.quantity} × ${first.nameSnapshot}` : first.nameSnapshot;
};

// Purchases (T19a; family tabs T29a, design round B2): every ticket order,
// membership and merchandise order the member has made, newest first. Ticket
// URLs are unchanged; each family opens its own order page.
export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ family?: string; limit?: string; cursor?: string; direction?: string }> }) {
  let user: Awaited<ReturnType<typeof requireAuthenticatedUser>>;
  try {
    user = await requireAuthenticatedUser();
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/login?callbackUrl=/purchases");
    throw error;
  }
  if (user.accountRole === "organisation") redirect("/dashboard");

  const raw = await searchParams;
  const family = families.find((name) => name === raw.family) ?? "tickets";
  const params = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[0] !== "family"));
  let pagination: ParsedPaginationOptions & { invalid?: boolean } = parsePaginationOptionsOrDefault(new URLSearchParams(params));
  const read = (options: ParsedPaginationOptions) =>
    family === "tickets" ? getOwnTicketPurchases(user.id, options) : getOwnCommerceOrders(user.id, options, family === "memberships" ? "membership" : "merchandise");
  let result: Awaited<ReturnType<typeof read>>;
  try {
    result = await read(pagination);
  } catch (error) {
    if (!(error instanceof PaginationError)) throw error;
    pagination = { limit: 25, direction: "next", invalid: true };
    result = await read(pagination);
  }
  const counts = await ownPurchaseCounts(user.id);
  const { pageInfo } = result;
  const pageHref = (cursor: string, direction: "next" | "prev") =>
    `/purchases?${new URLSearchParams({ ...(family !== "tickets" ? { family } : {}), ...(pageInfo.limit !== 25 ? { limit: String(pageInfo.limit) } : {}), cursor, direction })}`;
  const pageLink = buttonClasses({ variant: "secondary", size: "sm" });
  const tickets = family === "tickets" ? (result as Awaited<ReturnType<typeof getOwnTicketPurchases>>).items : [];
  const commerce = family === "tickets" ? [] : (result as Awaited<ReturnType<typeof getOwnCommerceOrders>>).items;
  const empty = family === "tickets" ? tickets.length === 0 : commerce.length === 0;

  return (
    <PersonalShell>
      <div className="grid gap-1">
        <h1 className="text-3xl font-semibold text-ink">Purchases</h1>
        <p className="text-ink-soft">Everything you&apos;ve bought or registered for, newest first.</p>
      </div>
      <LinkTabs
        label="Purchase types"
        tabs={families.map((name) => ({ href: name === "tickets" ? "/purchases" : `/purchases?family=${name}`, label: familyLabels[name], active: name === family, count: counts[name] }))}
      />
      {pagination.invalid ? <Notice tone="warning">Invalid pagination parameters were ignored. Showing the first page.</Notice> : null}
      {empty ? (
        <EmptyState
          action={
            family === "tickets" ? (
              <Link className={buttonClasses({ variant: "secondary" })} href="/events">
                Explore events
              </Link>
            ) : (
              <Link className={buttonClasses({ variant: "secondary" })} href="/societies">
                Explore societies
              </Link>
            )
          }
          icon="receipt"
          title={family === "tickets" ? "No purchases yet" : `No ${familyLabels[family].toLowerCase()} yet`}
        >
          {family === "tickets"
            ? "Tickets you buy or register for show here."
            : family === "memberships"
              ? "Memberships you buy or join for free show here."
              : "Merchandise you buy or order for free shows here."}
        </EmptyState>
      ) : family === "tickets" ? (
        <Table grid="md:grid-cols-[minmax(0,1fr)_170px_110px_150px]" headings={["Order", "Status", "Total", "Date"]} label="Ticket purchases">
          {tickets.map((order) => {
            const badge = buyerPurchaseBadge(order);
            return (
              <Row
                columns={[<StatusBadge key="status" label={badge.label} status={badge.status} />]}
                date={order.createdAt}
                detail={`${order.quantity} × ${purchasedTicketTypeLabel(order.purchasedTicketTypeName, order.ticketType.name)} · ${order.event.organisation.name}`}
                grid="md:grid-cols-[minmax(0,1fr)_170px_110px_150px]"
                href={`/purchases/tickets/${order.id}`}
                key={order.id}
                title={order.event.title}
                total={<PurchaseTotal order={order} />}
              />
            );
          })}
        </Table>
      ) : family === "memberships" ? (
        <Table grid="md:grid-cols-[minmax(0,1fr)_170px_110px_150px]" headings={["Membership", "Payment", "Total", "Date"]} label="Membership purchases">
          {commerce.map((order) => {
            const line = order.lines[0];
            return (
              <Row
                columns={[<PaymentBadge key="payment" order={order} />]}
                date={order.createdAt}
                detail={`${order.organisation.name}${line?.termStartsAt && line.termEndsAt ? ` · ${formatTerm(line.termStartsAt, line.termEndsAt, order.organisation.timeZone)}` : ""}`}
                grid="md:grid-cols-[minmax(0,1fr)_170px_110px_150px]"
                href={`/memberships/orders/${order.id}`}
                key={order.id}
                title={line?.nameSnapshot ?? "Membership"}
                total={<PurchaseTotal order={order} />}
              />
            );
          })}
        </Table>
      ) : (
        <Table grid="md:grid-cols-[minmax(0,1fr)_150px_160px_100px_150px]" headings={["Order", "Payment", "Pickup", "Total", "Date"]} label="Merchandise purchases">
          {commerce.map((order) => (
            <Row
              columns={[<PaymentBadge key="payment" order={order} />, <Pickup key="pickup" order={order} />]}
              date={order.createdAt}
              detail={`${order.organisation.name} · Order ${orderReference(order.id)}`}
              grid="md:grid-cols-[minmax(0,1fr)_150px_160px_100px_150px]"
              href={`/merchandise/orders/${order.id}`}
              key={order.id}
              title={summary(order)}
              total={<PurchaseTotal order={order} />}
            />
          ))}
        </Table>
      )}
      {family === "merchandise" && !empty ? (
        <p className="text-sm text-ink-soft">Payment and pickup are tracked separately: a paid order still needs collecting, and a refund doesn&apos;t mean the item came back.</p>
      ) : null}
      {pageInfo.previousCursor || pageInfo.nextCursor ? (
        <nav aria-label="Purchases pagination" className="flex flex-wrap items-center justify-between gap-3">
          {pageInfo.previousCursor ? <Link className={pageLink} href={pageHref(pageInfo.previousCursor, "prev")}>Previous</Link> : <span />}
          {pageInfo.nextCursor ? <Link className={pageLink} href={pageHref(pageInfo.nextCursor, "next")}>Next</Link> : null}
        </nav>
      ) : null}
    </PersonalShell>
  );
}
