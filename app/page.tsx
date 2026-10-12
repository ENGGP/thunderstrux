import Link from "next/link";
import { EventCard } from "@/components/events/event-card";
import { SiteFooter } from "@/components/layout/site-footer";
import { SocietyCard } from "@/components/organisations/society-card";
import { buttonClasses } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { getPublishedEvents } from "@/lib/events/public-events";
import {
  discoverOrganisations,
  discoveryInput
} from "@/lib/organisations/discovery";
import {
  PaginationError,
  parsePaginationOptionsOrDefault
} from "@/lib/pagination/cursor";

export const dynamic = "force-dynamic";

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

  const societies = await discoverOrganisations(
    discoveryInput(new URLSearchParams({ limit: "4" }))
  );
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
    <>
      <main className="bg-paper">
        <section className="bg-brand-ink text-white">
          <div className="mx-auto grid max-w-page gap-6 px-4 py-14 md:px-8 md:py-20">
            <h1 className="max-w-3xl font-display text-4xl font-semibold leading-tight md:text-6xl">
              Discover events at your campus
            </h1>
            <p className="max-w-xl text-lg text-white/80">
              See what student societies are running, get your tickets and
              follow the people behind them.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                className={buttonClasses({
                  size: "lg",
                  variant: "tertiary",
                  className: "bg-white text-brand-ink no-underline hover:bg-brand-tint hover:no-underline"
                })}
                href="/societies"
              >
                Find a society
              </Link>
              <Link
                className={buttonClasses({
                  size: "lg",
                  variant: "tertiary",
                  className: "text-white"
                })}
                href="/signup"
              >
                Create a society
              </Link>
            </div>
          </div>
        </section>

        <div className="mx-auto grid max-w-page gap-14 px-4 py-12 md:px-8 md:py-16">
          <section aria-labelledby="upcoming-events" className="grid gap-6">
            <h2
              className="border-l-[3px] border-brand pl-3 text-2xl font-semibold text-ink"
              id="upcoming-events"
            >
              Upcoming events
            </h2>

            {pagination.invalid ? (
              <Notice tone="warning">
                Invalid pagination parameters were ignored. Showing the first
                page.
              </Notice>
            ) : null}

            {result.events.length === 0 ? (
              <div className="rounded-card border border-line bg-surface p-6 text-ink-soft">
                <p className="font-semibold text-ink">No events available</p>
                <p className="mt-1 text-sm">
                  Nothing is published right now.{" "}
                  <Link className="text-brand underline" href="/societies">
                    Browse societies
                  </Link>{" "}
                  to see who is active.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {result.events.map((event) => (
                  <EventCard
                    id={event.id}
                    key={event.id}
                    location={event.location}
                    society={event.organisation}
                    startTime={event.startTime}
                    timeZone={event.organisation.timeZone}
                    title={event.title}
                  />
                ))}
              </div>
            )}

            {result.pageInfo.hasPreviousPage || result.pageInfo.hasNextPage ? (
              <nav
                aria-label="Public event pagination"
                className="flex flex-wrap items-center justify-between gap-3"
              >
                {result.pageInfo.previousCursor ? (
                  <Link
                    className={buttonClasses({ variant: "secondary" })}
                    href={paginationHref(result.pageInfo.previousCursor, "prev")}
                  >
                    Previous
                  </Link>
                ) : (
                  <span />
                )}
                {result.pageInfo.nextCursor ? (
                  <Link
                    className={buttonClasses({ variant: "secondary" })}
                    href={paginationHref(result.pageInfo.nextCursor, "next")}
                  >
                    Next
                  </Link>
                ) : null}
              </nav>
            ) : null}
          </section>

          {societies.organisations.length > 0 ? (
            <section aria-labelledby="discover-societies" className="grid gap-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h2
                  className="border-l-[3px] border-brand pl-3 text-2xl font-semibold text-ink"
                  id="discover-societies"
                >
                  Discover societies
                </h2>
                <Link
                  className="text-sm font-semibold text-brand underline"
                  href="/societies"
                >
                  All societies
                </Link>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {societies.organisations.map((society) => (
                  <SocietyCard key={society.id} {...society} />
                ))}
              </div>
            </section>
          ) : null}

          <section className="grid gap-4 rounded-feature bg-warm-paper p-8 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <h2 className="text-2xl font-semibold text-ink">
                Running a society?
              </h2>
              <p className="mt-2 max-w-xl text-ink-soft">
                Publish events, sell tickets and hand the account to next
                year&apos;s committee without losing your history.
              </p>
            </div>
            <Link className={buttonClasses({ size: "lg" })} href="/signup">
              Create a society
            </Link>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
