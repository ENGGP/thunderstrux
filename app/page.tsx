import Link from "next/link";
import { getPublishedEvents } from "@/lib/events/public-events";
import {
  PaginationError,
  parsePaginationOptionsOrDefault
} from "@/lib/pagination/cursor";

export const dynamic = "force-dynamic";

function formatDateTime(value: Date) {
  if (Number.isNaN(value.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Brisbane"
  }).format(value);
}

export default async function Home({
  searchParams
}: {
  searchParams: Promise<{
    limit?: string;
    cursor?: string;
    direction?: string;
  }>;
}) {
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
  let result;

  try {
    result = await getPublishedEvents(pagination);
  } catch (error) {
    if (!(error instanceof PaginationError)) {
      throw error;
    }

    pagination = {
      limit: 25,
      direction: "next",
      invalid: true
    };
    result = await getPublishedEvents(pagination);
  }

  const paginationBaseParams = new URLSearchParams();

  if (result.pageInfo.limit !== 25) {
    paginationBaseParams.set("limit", String(result.pageInfo.limit));
  }

  function paginationHref(cursor: string, direction: "next" | "prev") {
    const params = new URLSearchParams(paginationBaseParams);
    params.set("cursor", cursor);
    params.set("direction", direction);
    return `/?${params.toString()}`;
  }

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <h1 className="text-3xl font-semibold text-neutral-950 sm:text-4xl">
            Discover Events
          </h1>
        </header>

        {pagination.invalid ? (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Invalid pagination parameters were ignored. Showing the first page.
          </section>
        ) : null}

        {result.events.length === 0 ? (
          <section className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-600 shadow-sm">
            No events available
          </section>
        ) : (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {result.events.map((event) => (
              <article
                className="flex min-h-56 flex-col rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
                key={event.id}
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-neutral-500">
                    {event.organisation.name}
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-neutral-950">
                    {event.title}
                  </h2>
                  <dl className="mt-4 grid gap-3 text-sm text-neutral-700">
                    <div>
                      <dt className="font-medium text-neutral-950">Date</dt>
                      <dd className="mt-1">{formatDateTime(event.startTime)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-neutral-950">Location</dt>
                      <dd className="mt-1">{event.location}</dd>
                    </div>
                  </dl>
                </div>

                <Link
                  className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700"
                  href={`/events/${event.id}`}
                >
                  View Event
                </Link>
              </article>
            ))}
          </section>
        )}

        {result.pageInfo.hasPreviousPage || result.pageInfo.hasNextPage ? (
          <nav
            aria-label="Public event pagination"
            className="flex flex-wrap items-center justify-between gap-3"
          >
            {result.pageInfo.previousCursor ? (
              <Link
                className="inline-flex h-10 items-center justify-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-900 transition hover:bg-neutral-50"
                href={paginationHref(result.pageInfo.previousCursor, "prev")}
              >
                Previous
              </Link>
            ) : (
              <span />
            )}
            {result.pageInfo.nextCursor ? (
              <Link
                className="inline-flex h-10 items-center justify-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-900 transition hover:bg-neutral-50"
                href={paginationHref(result.pageInfo.nextCursor, "next")}
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
