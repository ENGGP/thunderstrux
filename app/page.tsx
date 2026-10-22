import Link from "next/link";
import { Suspense } from "react";
import { EventCard } from "@/components/events/event-card";
import { SiteFooter } from "@/components/layout/site-footer";
import { SocietyCard } from "@/components/organisations/society-card";
import { buttonClasses } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getPublishedEvents } from "@/lib/events/public-events";
import {
  discoverOrganisations,
  discoveryInput
} from "@/lib/organisations/discovery";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <main id="main" tabIndex={-1} className="bg-paper">
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
                  className: "bg-surface text-brand-ink no-underline hover:bg-brand-tint hover:no-underline"
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
          <Suspense fallback={<HomeSkeleton />}>
            <HomeListings />
          </Suspense>
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

function HomeSkeleton() {
  return (
    <div className="grid gap-6">
      <p className="sr-only">Loading events</p>
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton className="h-28 rounded-card" key={index} />
        ))}
      </div>
    </div>
  );
}

// A short look ahead; the full, filtered list lives at /events.
async function HomeListings() {
  const result = await getPublishedEvents({ limit: 6 });
  const societies = await discoverOrganisations(
    discoveryInput(new URLSearchParams({ limit: "4" }))
  );

  return (
    <>
      <section aria-labelledby="upcoming-events" className="grid gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2
            className="border-l-[3px] border-brand pl-3 text-2xl font-semibold text-ink"
            id="upcoming-events"
          >
            Upcoming events
          </h2>
          <Link
            className="text-sm font-semibold text-brand underline"
            href="/events"
          >
            Explore all events
          </Link>
        </div>

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
                heroAssetId={event.heroAssetId}
                startTime={event.startTime}
                timeZone={event.organisation.timeZone}
                title={event.title}
              />
            ))}
          </div>
        )}
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
    </>
  );
}
