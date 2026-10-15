import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PersonalShell } from "@/components/layout/personal-shell";
import { buttonClasses } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { ListSkeleton } from "@/components/ui/skeleton";
import { DateRail } from "@/components/events/date-rail";
import {
  AuthenticationRequiredError,
  requireAuthenticatedUser
} from "@/lib/auth/access";
import { formatDateTime, formatMoney } from "@/lib/format";
import { getMemberTicketOrders } from "@/lib/orders/member-tickets";
import { purchasedTicketTypeLabel } from "@/lib/purchases/projection";
import {
  PaginationError,
  parsePaginationOptionsOrDefault
} from "@/lib/pagination/cursor";

type MemberTicketOrderPage = Awaited<ReturnType<typeof getMemberTicketOrders>>;

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
  const pagination = parsePaginationOptionsOrDefault(
    new URLSearchParams({
      ...(limitParam ? { limit: limitParam } : {}),
      ...(cursorParam ? { cursor: cursorParam } : {}),
      ...(directionParam ? { direction: directionParam } : {})
    })
  );
  return (
    <PersonalShell>
      <div className="grid gap-1">
        <h1 className="text-3xl font-semibold text-ink">My tickets</h1>
        <p className="text-ink-soft">Show your name and ticket number at the door.</p>
      </div>
      <Suspense fallback={<ListSkeleton label="Loading your tickets" rows={3} />}>
        <TicketOrders pagination={pagination} userId={user.id} />
      </Suspense>
    </PersonalShell>
  );
}

async function TicketOrders({
  userId,
  pagination: initialPagination
}: {
  userId: string;
  pagination: ReturnType<typeof parsePaginationOptionsOrDefault>;
}) {
  let pagination = initialPagination;
  let orderResult: MemberTicketOrderPage;

  try {
    orderResult = await getMemberTicketOrders(userId, pagination);
  } catch (error) {
    if (!(error instanceof PaginationError)) {
      throw error;
    }

    pagination = {
      limit: 25,
      direction: "next",
      invalid: true
    };
    orderResult = await getMemberTicketOrders(userId, pagination);
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

  const pageLink = buttonClasses({ variant: "secondary", size: "sm" });

  return (
    <>
      {pagination.invalid ? (
        <Notice tone="warning">
          Invalid pagination parameters were ignored. Showing the first page.
        </Notice>
      ) : null}

      {orders.length === 0 ? (
        <div className="grid justify-items-start gap-3 rounded-card border border-line bg-surface p-6">
          <p className="text-ink-soft">You have not bought any tickets yet.</p>
          <Link className={buttonClasses()} href="/">
            Browse events
          </Link>
        </div>
      ) : (
        <ul className="grid gap-4">
          {orders.map((order) => {
            const timeZone = order.event.organisation.timeZone;

            return (
              <li className="flex gap-4 rounded-card border border-line bg-surface p-5" key={order.id}>
                <DateRail date={order.event.startTime} timeZone={timeZone} />
                <div className="grid min-w-0 flex-1 gap-1">
                  <h2 className="text-lg font-semibold text-ink [overflow-wrap:anywhere]">
                    <Link className="underline-offset-4 hover:underline" href={`/events/${order.event.id}`}>
                      {order.event.title}
                    </Link>
                  </h2>
                  <p className="text-sm text-ink-soft">
                    {formatDateTime(order.event.startTime, { dateStyle: "full", timeZone })} ·{" "}
                    {order.event.organisation.name}
                  </p>
                  <p className="text-sm text-ink">
                    {order.quantity} × {purchasedTicketTypeLabel(order.purchasedTicketTypeName, order.ticketType.name)} ·{" "}
                    <span className="tabular-nums">{formatMoney(order.totalAmount)}</span>
                  </p>
                  {order.tickets.length > 0 ? (
                    <ul aria-label="Ticket numbers" className="mt-1 flex flex-wrap gap-2">
                      {order.tickets.map((ticket) => (
                        <li
                          className="rounded-tag border border-line bg-surface-subtle px-2 py-0.5 font-mono text-sm text-ink"
                          key={ticket.id}
                          title={ticket.id}
                        >
                          Ticket {ticket.id.slice(-6)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-ink-soft">Tickets have not been issued for this order yet.</p>
                  )}
                  <p className="text-[13px] text-ink-muted">
                    Bought {formatDateTime(order.paidAt ?? order.createdAt)} ·{" "}
                    <span title={order.id}>Order {order.id.slice(-6).toUpperCase()}</span>
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pageInfo.hasPreviousPage || pageInfo.hasNextPage ? (
        <nav aria-label="Ticket pagination" className="flex flex-wrap items-center justify-between gap-3">
          {pageInfo.previousCursor ? (
            <Link className={pageLink} href={paginationHref(pageInfo.previousCursor, "prev")}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          {pageInfo.nextCursor ? (
            <Link className={pageLink} href={paginationHref(pageInfo.nextCursor, "next")}>
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
