import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PersonalShell } from "@/components/layout/personal-shell";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/auth/access";
import { formatDateTime, formatPrice } from "@/lib/format";
import { PaginationError, parsePaginationOptionsOrDefault } from "@/lib/pagination/cursor";
import { buyerPurchaseBadge, purchasedTicketTypeLabel, ticketOrderProjection } from "@/lib/purchases/projection";
import { getOwnTicketPurchases } from "@/lib/purchases/ticket-purchases";

export const metadata: Metadata = { title: "Purchases" };

type Purchase = Awaited<ReturnType<typeof getOwnTicketPurchases>>["items"][number];

// What the buyer paid, in the words that fit the order's state.
function PurchaseTotal({ order }: { order: Purchase }) {
  const projection = ticketOrderProjection(order);
  if (projection === "failed" || projection === "expired") return <span className="text-ink-soft">Not charged</span>;
  if (order.paymentKind === "free") return <span>Free</span>;
  if (projection === "refunded") return <s className="text-ink-muted">{formatPrice(order.totalAmount)}</s>;
  return <span>{formatPrice(order.totalAmount)}</span>;
}

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ limit?: string; cursor?: string; direction?: string }> }) {
  let user: Awaited<ReturnType<typeof requireAuthenticatedUser>>;
  try {
    user = await requireAuthenticatedUser();
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/login?callbackUrl=/purchases");
    throw error;
  }
  if (user.accountRole === "organisation") redirect("/dashboard");

  const params = Object.fromEntries(Object.entries(await searchParams).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  let pagination = parsePaginationOptionsOrDefault(new URLSearchParams(params));
  let result: Awaited<ReturnType<typeof getOwnTicketPurchases>>;
  try {
    result = await getOwnTicketPurchases(user.id, pagination);
  } catch (error) {
    if (!(error instanceof PaginationError)) throw error;
    pagination = { limit: 25, direction: "next", invalid: true };
    result = await getOwnTicketPurchases(user.id, pagination);
  }
  const { items: orders, pageInfo } = result;
  const pageHref = (cursor: string, direction: "next" | "prev") =>
    `/purchases?${new URLSearchParams({ ...(pageInfo.limit !== 25 ? { limit: String(pageInfo.limit) } : {}), cursor, direction })}`;
  const pageLink = buttonClasses({ variant: "secondary", size: "sm" });

  return (
    <PersonalShell>
      <div className="grid gap-1">
        <h1 className="text-3xl font-semibold text-ink">Purchases</h1>
        <p className="text-ink-soft">Every ticket order you&apos;ve made, newest first.</p>
      </div>
      {pagination.invalid ? <Notice tone="warning">Invalid pagination parameters were ignored. Showing the first page.</Notice> : null}
      {orders.length === 0 ? (
        <EmptyState action={<Link className={buttonClasses({ variant: "secondary" })} href="/events">Explore events</Link>} icon="receipt" title="No purchases yet">
          Tickets you buy or register for show here.
        </EmptyState>
      ) : (
        <section aria-label="Purchases" className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="hidden grid-cols-[minmax(0,1fr)_170px_110px_150px] gap-4 bg-surface-subtle px-5 py-2.5 text-[13px] font-semibold text-ink-muted md:grid">
            <span>Order</span><span>Status</span><span>Total</span><span>Date</span>
          </div>
          <ul>
            {orders.map((order) => {
              const badge = buyerPurchaseBadge(order);
              const ticketType = purchasedTicketTypeLabel(order.purchasedTicketTypeName, order.ticketType.name);
              return (
                <li className="grid gap-1.5 border-t border-line px-4 py-3.5 first:border-t-0 md:grid-cols-[minmax(0,1fr)_170px_110px_150px] md:items-center md:gap-4 md:px-5 md:first:border-t" key={order.id}>
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <Link className="font-semibold text-brand underline-offset-4 hover:underline [overflow-wrap:anywhere]" href={`/purchases/tickets/${order.id}`}>
                        {order.event.title}
                      </Link>
                      <span className="tabular-nums md:hidden"><PurchaseTotal order={order} /></span>
                    </div>
                    <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
                      {order.quantity} × {ticketType} · {order.event.organisation.name}
                      <span className="md:hidden"> · {formatDateTime(order.createdAt)}</span>
                    </p>
                  </div>
                  <span><StatusBadge label={badge.label} status={badge.status} /></span>
                  <span className="hidden tabular-nums md:block"><PurchaseTotal order={order} /></span>
                  <span className="hidden text-sm text-ink-soft md:block">{formatDateTime(order.createdAt)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {pageInfo.previousCursor || pageInfo.nextCursor ? (
        <nav aria-label="Purchases pagination" className="flex flex-wrap items-center justify-between gap-3">
          {pageInfo.previousCursor ? <Link className={pageLink} href={pageHref(pageInfo.previousCursor, "prev")}>Previous</Link> : <span />}
          {pageInfo.nextCursor ? <Link className={pageLink} href={pageHref(pageInfo.nextCursor, "next")}>Next</Link> : null}
        </nav>
      ) : null}
    </PersonalShell>
  );
}
