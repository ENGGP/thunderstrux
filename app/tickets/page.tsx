import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AuthenticationRequiredError,
  requireAuthenticatedUser
} from "@/lib/auth/access";
import { prisma } from "@/lib/db";
import {
  PaginationError,
  decodeTimestampCursor,
  descendingCursorWhere,
  orderByForDirection,
  pageInfoForPage,
  parsePaginationOptionsOrDefault,
  type PageInfo,
  type ParsedPaginationOptions
} from "@/lib/pagination/cursor";

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

async function getMemberTicketOrders(
  userId: string,
  {
    limit,
    cursor,
    direction
  }: ParsedPaginationOptions
) {
  const decodedCursor = cursor
    ? decodeTimestampCursor("createdAt", cursor)
    : null;
  const cursorWhere = decodedCursor
    ? descendingCursorWhere("createdAt", decodedCursor, direction)
    : {};
  const orders = await prisma.order.findMany({
    where: {
      userId,
      status: "paid",
      ...cursorWhere
    },
    orderBy: orderByForDirection("createdAt", direction, "desc"),
    take: limit + 1,
    select: {
      id: true,
      status: true,
      quantity: true,
      totalAmount: true,
      createdAt: true,
      paidAt: true,
      failedAt: true,
      failureReason: true,
      event: {
        select: {
          id: true,
          title: true,
          startTime: true,
          organisation: {
            select: {
              name: true
            }
          }
        }
      },
      ticketType: {
        select: {
          name: true
        }
      },
      tickets: {
        select: {
          id: true,
          createdAt: true
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });

  return pageInfoForPage({
    items: orders,
    limit,
    direction,
    cursor,
    timestampField: "createdAt"
  });
}

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
    <main className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold text-neutral-950">My tickets</h1>
          <p className="text-sm text-neutral-600">
            View your ticket purchases and payment status.
          </p>
        </header>

        {pagination.invalid ? (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Invalid pagination parameters were ignored. Showing the first page.
          </section>
        ) : null}

        {orders.length === 0 ? (
          <section className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-600 shadow-sm">
            <p>You have not purchased any tickets yet.</p>
            <Link
              className="mt-4 inline-flex items-center justify-center rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700"
              href="/"
            >
              Browse events
            </Link>
          </section>
        ) : (
          <section className="space-y-4">
            {orders.map((order) => (
              <article
                className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm"
                key={order.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-neutral-500">
                      {order.event.organisation.name}
                    </p>
                    <h2 className="text-xl font-semibold text-neutral-950">
                      {order.event.title}
                    </h2>
                    <p className="text-sm text-neutral-600">
                      {order.ticketType.name} x {order.quantity}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-neutral-950">
                      {statusLabel(order.status)}
                    </p>
                    <p className="mt-1 text-sm text-neutral-600">
                      {formatCurrency(order.totalAmount)}
                    </p>
                  </div>
                </div>

                <dl className="mt-5 grid gap-3 text-sm text-neutral-700 sm:grid-cols-3">
                  <div>
                    <dt className="font-medium text-neutral-950">Purchased</dt>
                    <dd className="mt-1">{formatDateTime(order.paidAt ?? order.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-neutral-950">Event date</dt>
                    <dd className="mt-1">{formatDateTime(order.event.startTime)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-neutral-950">Order ID</dt>
                    <dd className="mt-1 break-all">{order.id}</dd>
                  </div>
                </dl>

                {order.status === "pending" ? (
                  <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Payment is still pending. Tickets will appear after Stripe confirms payment.
                  </p>
                ) : null}

                {order.status === "failed" ? (
                  <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    Payment could not be fulfilled locally. Contact support with this order ID.
                  </p>
                ) : null}

                {order.status === "expired" ? (
                  <p className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
                    Checkout expired before payment completed. No tickets were issued.
                  </p>
                ) : null}

                {order.tickets.length > 0 ? (
                  <div className="mt-5">
                    <h3 className="text-sm font-medium text-neutral-950">
                      Ticket identifiers
                    </h3>
                    <ul className="mt-2 grid gap-2 text-sm text-neutral-700">
                      {order.tickets.map((ticket) => (
                        <li
                          className="break-all rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2"
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
                className="inline-flex h-10 items-center justify-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-900 transition hover:bg-neutral-50"
                href={paginationHref(pageInfo.previousCursor, "prev")}
              >
                Previous
              </Link>
            ) : (
              <span />
            )}
            {pageInfo.nextCursor ? (
              <Link
                className="inline-flex h-10 items-center justify-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-900 transition hover:bg-neutral-50"
                href={paginationHref(pageInfo.nextCursor, "next")}
              >
                Next
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </main>
  );
}
