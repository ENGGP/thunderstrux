import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PersonalShell } from "@/components/layout/personal-shell";
import { buttonClasses } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  AuthenticationRequiredError,
  requireAuthenticatedUser
} from "@/lib/auth/access";
import { formatDateTime, formatMoney } from "@/lib/format";
import { getMemberTicketOrders } from "@/lib/orders/member-tickets";
import {
  PaginationError,
  parsePaginationOptionsOrDefault,
  type PageInfo
} from "@/lib/pagination/cursor";

type MemberTicketOrderPage = Awaited<ReturnType<typeof getMemberTicketOrders>>;

function emptyPageInfo(limit: number): PageInfo {
  return {
    limit,
    hasNextPage: false,
    hasPreviousPage: false,
    nextCursor: null,
    previousCursor: null
  };
}

export const metadata: Metadata = { title: "My tickets" };

export default async function MyTicketsPage({
  searchParams
}: {
  searchParams: Promise<{
    limit?: string;
    cursor?: string;
    direction?: string;
  }>;
}) {
  let user: Awaited<ReturnType<typeof requireAuthenticatedUser>>;

  try {
    user = await requireAuthenticatedUser();
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      redirect("/login?callbackUrl=/tickets");
    }

    throw error;
  }

  if (user.accountRole === "organisation") {
    redirect("/dashboard");
  }

  const {
    limit: limitParam,
    cursor: cursorParam,
    direction: directionParam
  } = await searchParams;
  let pagination = parsePaginationOptionsOrDefault(
    new URLSearchParams({
      ...(limitParam ? { limit: limitParam } : {}),
      ...(cursorParam ? { cursor: cursorParam } : {}),
      ...(directionParam ? { direction: directionParam } : {})
    })
  );
  let orderResult: MemberTicketOrderPage;

  try {
    orderResult = await getMemberTicketOrders(user.id, pagination);
  } catch (error) {
    if (!(error instanceof PaginationError)) {
      throw error;
    }

    pagination = {
      limit: 25,
      direction: "next",
      invalid: true
    };
    orderResult = {
      items: [],
      pageInfo: emptyPageInfo(pagination.limit)
    };
    orderResult = await getMemberTicketOrders(user.id, pagination);
  }

  const orders = orderResult.items;
  const pageInfo = orderResult.pageInfo;
  const paginationBaseParams = new URLSearchParams();

  if (pageInfo.limit !== 25) {
    paginationBaseParams.set("limit", String(pageInfo.limit));
  }

  function paginationHref(cursor: string, direction: "next" | "prev") {
    const params = new URLSearchParams(paginationBaseParams);
    params.set("cursor", cursor);
    params.set("direction", direction);
    return `/tickets?${params.toString()}`;
  }

  return (
    <PersonalShell>
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold text-ink">My tickets</h1>
          <p className="text-sm text-ink-muted">
            View your ticket purchases and payment status.
          </p>
        </header>

        {pagination.invalid ? (
          <Notice tone="warning">
            Invalid pagination parameters were ignored. Showing the first page.
          </Notice>
        ) : null}

        {orders.length === 0 ? (
          <section className="rounded-card border border-line bg-surface p-6 text-sm text-ink-muted">
            <p>You have not purchased any tickets yet.</p>
            <Link className={buttonClasses({ className: "mt-4" })} href="/">
              Browse events
            </Link>
          </section>
        ) : (
          <section className="space-y-4">
            {orders.map((order) => (
              <article
                className="rounded-card border border-line bg-surface p-6"
                key={order.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-ink-muted">
                      {order.event.organisation.name}
                    </p>
                    <h2 className="text-xl font-semibold text-ink">
                      {order.event.title}
                    </h2>
                    <p className="text-sm text-ink-muted">
                      {order.ticketType.name} x {order.quantity}
                    </p>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={order.status} />
                    <p className="mt-1 text-sm text-ink-muted">
                      {formatMoney(order.totalAmount)}
                    </p>
                  </div>
                </div>

                <dl className="mt-5 grid gap-3 text-sm text-ink-soft sm:grid-cols-3">
                  <div>
                    <dt className="font-medium text-ink">Purchased</dt>
                    <dd className="mt-1">{formatDateTime(order.paidAt ?? order.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-ink">Event date</dt>
                    <dd className="mt-1">
                      {formatDateTime(order.event.startTime, {
                        timeZone: order.event.organisation.timeZone
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-ink">Order ID</dt>
                    <dd className="mt-1 break-all">{order.id}</dd>
                  </div>
                </dl>

                {order.status === "pending" ? (
                  <p className="mt-4 rounded-control border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
                    Payment is still pending. Tickets will appear after Stripe confirms payment.
                  </p>
                ) : null}

                {order.status === "failed" ? (
                  <p className="mt-4 rounded-control border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
                    Payment could not be fulfilled locally. Contact support with this order ID.
                  </p>
                ) : null}

                {order.status === "expired" ? (
                  <p className="mt-4 rounded-control border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-soft">
                    Checkout expired before payment completed. No tickets were issued.
                  </p>
                ) : null}

                {order.tickets.length > 0 ? (
                  <div className="mt-5">
                    <h3 className="text-sm font-medium text-ink">
                      Ticket identifiers
                    </h3>
                    <ul className="mt-2 grid gap-2 text-sm text-ink-soft">
                      {order.tickets.map((ticket) => (
                        <li
                          className="break-all rounded-control border border-line bg-surface-subtle px-3 py-2"
                          key={ticket.id}
                        >
                          {ticket.id}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            ))}
          </section>
        )}

        {pageInfo.hasPreviousPage || pageInfo.hasNextPage ? (
          <nav
            aria-label="Ticket pagination"
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
    </PersonalShell>
  );
}
