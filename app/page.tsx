import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DateRail } from "@/components/events/date-rail";
import { EventCard } from "@/components/events/event-card";
import { SiteFooter } from "@/components/layout/site-footer";
import { SocietyCard } from "@/components/organisations/society-card";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { quietLinkClasses } from "@/components/ui/link-tabs";
import { CardGridSkeleton, Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { getLiveSession } from "@/lib/auth/live-session";
import { appUrl } from "@/lib/app-url";
import { getPublishedEvents } from "@/lib/events/public-events";
import { formatDateTime, listingPriceLabel } from "@/lib/format";
import {
  discoverOrganisations,
  discoveryInput
} from "@/lib/organisations/discovery";

export const dynamic = "force-dynamic";

// A shared link to the home page previews as Thunderstrux, not a bare URL.
export async function generateMetadata(): Promise<Metadata> {
  const origin = appUrl();
  const description = "See what student societies are running and get your tickets, memberships and merchandise.";
  return {
    description,
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    openGraph: { title: "Thunderstrux", description, type: "website", siteName: "Thunderstrux" }
  };
}

// PUB-01: three short notes for first-time visitors; no screenshots or claims.
const howItWorks = [
  {
    title: "Find what's on",
    body: "Browse events from every society on campus with the price shown up front, and get tickets as a guest or with an account."
  },
  {
    title: "Join your societies",
    body: "Follow a society for free to keep up with its events, or buy its semester or full-year membership when it sells one."
  },
  {
    title: "Run a society",
    body: "Sell tickets, memberships and merch in one place and check people in at the door. Free events cost nothing; paid sales carry a 3.75% plus $0.89 fee per ticket, membership or merchandise order, card processing included."
  }
];

export default async function Home() {
  // A society needs its own account, so signed-in visitors are not offered one here.
  const signedIn = Boolean((await getLiveSession())?.user);
  // The soonest public event, shown as a ticket stub beside the headline on wide screens.
  const [heroEvent] = (await getPublishedEvents({ limit: 1 })).events;

  return (
    <>
      <main id="main" tabIndex={-1} className="bg-paper">
        <section className="surface-night">
          <div className="mx-auto grid max-w-page gap-10 px-4 py-14 md:px-8 md:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-center">
            <div className="grid gap-6">
              <h1 className="max-w-3xl text-balance font-display text-4xl font-semibold leading-[1.1] md:text-6xl md:leading-[1.06]">
                Discover events at your <span className="text-glow">campus</span>
              </h1>
              <p className="max-w-xl text-lg text-white/80">
                See what student societies are running, get your tickets and
                follow the people behind them.
              </p>
              <div className="flex flex-wrap gap-3">
                {/* Beside the ticket stub (wide screens only), Get tickets is the one filled button. */}
                <Link
                  className={buttonClasses({
                    size: "lg",
                    variant: "onNight",
                    className: heroEvent ? "lg:border-glow lg:bg-transparent lg:text-white lg:hover:bg-night-raised" : ""
                  })}
                  href="/events"
                >
                  See what&apos;s on
                </Link>
                <Link className={buttonClasses({ size: "lg", variant: "ghostNight" })} href="/societies">
                  Find a society
                </Link>
              </div>
            </div>
            {heroEvent ? <HeroEvent event={heroEvent} /> : null}
          </div>
        </section>

        <div className="mx-auto grid max-w-page gap-14 px-4 py-12 md:gap-20 md:px-8 md:py-16">
          <Suspense fallback={<HomeSkeleton />}>
            <HomeListings heroEventId={heroEvent?.id ?? null} />
          </Suspense>
          {signedIn ? null : (
            <section aria-labelledby="how-it-works" className="grid gap-6">
              <h2 className="text-2xl font-semibold text-ink" id="how-it-works">
                How Thunderstrux works
              </h2>
              <ul className="grid gap-6 md:grid-cols-3">
                {howItWorks.map((step) => (
                  <li className="grid content-start gap-2 border-t border-line pt-4" key={step.title}>
                    <h3 className="text-lg font-semibold text-ink">{step.title}</h3>
                    <p className="text-ink-soft">{step.body}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {signedIn ? null : (
            <section className="grid gap-4 rounded-feature border border-line bg-surface p-8 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <h2 className="text-2xl font-semibold text-ink">
                  Running a society?
                </h2>
                <p className="mt-2 max-w-xl text-ink-soft">
                  Publish events, sell tickets and hand the account to next
                  year&apos;s committee without losing your history.
                </p>
              </div>
              <Link className={buttonClasses({ size: "lg", variant: "secondary" })} href="/signup?for=society">
                Create a society
              </Link>
            </section>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

// Shaped like the listings it stands in for (six event cards, then four
// society cards), so the sections below don't jump when they stream in.
function HomeSkeleton() {
  return (
    <>
      <div className="grid gap-6">
        <Skeleton className="h-8 w-56" />
        <CardGridSkeleton label="Loading events" />
      </div>
      <div aria-hidden="true" className="grid gap-6">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton className="h-28 rounded-card" key={index} />
          ))}
        </div>
      </div>
    </>
  );
}

type HeroEventData = Awaited<ReturnType<typeof getPublishedEvents>>["events"][number];

// The soonest public event as a ticket stub: the date tile, what and where, a tear
// line, then the price and Get tickets. Wide screens only; phones keep the words.
function HeroEvent({ event }: { event: HeroEventData }) {
  const timeZone = event.organisation.timeZone;
  const href = `/events/${event.id}`;
  const { availability } = event;
  return (
    <article className="hidden gap-5 rounded-card bg-surface p-6 text-ink lg:grid">
      <div className="flex gap-4">
        <DateRail date={event.startTime} timeZone={timeZone} />
        <div className="grid min-w-0 content-start gap-1">
          <Link className="w-fit text-sm text-ink-muted underline-offset-4 hover:text-brand hover:underline" href={`/societies/${event.organisation.slug}`}>
            {event.organisation.name}
          </Link>
          <h2 className="font-sans text-xl font-semibold leading-snug [overflow-wrap:anywhere]">
            <Link className="underline-offset-4 hover:underline" href={href}>{event.title}</Link>
          </h2>
          <p className="text-sm text-ink-soft">{formatDateTime(event.startTime, { timeZone, fallback: "Date unavailable" })}</p>
          <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{event.location}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-dashed border-line pt-4">
        {availability?.state === "on_sale" ? (
          <>
            <span className="font-semibold tabular-nums">{listingPriceLabel(availability.prices)}</span>
            <Link className={buttonClasses()} href={href}>Get tickets</Link>
          </>
        ) : (
          <>
            {availability?.state === "sold_out" || availability?.state === "sales_closed" ? (
              <StatusBadge status={availability.state === "sold_out" ? "sold-out" : "sales-closed"} />
            ) : <span className="text-sm text-ink-soft">Paid tickets unavailable right now</span>}
            <Link className={buttonClasses({ variant: "secondary" })} href={href}>See event</Link>
          </>
        )}
      </div>
    </article>
  );
}

// A short look ahead; the full, filtered list lives at /events. On wide screens the
// hero already shows the soonest event, so the grid starts at the next one there.
async function HomeListings({ heroEventId }: { heroEventId: string | null }) {
  const result = await getPublishedEvents({ limit: heroEventId ? 7 : 6 });
  const wideOnly = heroEventId && result.events.length === 7 ? result.events[6].id : null;
  // The home page features societies that have something to show: an upcoming event, then a description.
  // Directory order (by name) stays as it is; this only re-ranks a first dozen.
  const found = await discoverOrganisations(discoveryInput(new URLSearchParams({ limit: "12" })));
  const rank = (society: (typeof found.organisations)[number]) => (society.nextEvent ? 2 : 0) + (society.description ? 1 : 0);
  const societies = { organisations: [...found.organisations].sort((a, b) => rank(b) - rank(a)).slice(0, 4) };

  return (
    <>
      <section aria-labelledby="upcoming-events" className="grid gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-2xl font-semibold text-ink" id="upcoming-events">
            Upcoming events
          </h2>
          <Link className={`text-sm ${quietLinkClasses}`} href="/events">
            Explore all events
          </Link>
        </div>

        {result.events.length === 0 ? (
          <EmptyState
            action={<Link className={buttonClasses({ variant: "secondary" })} href="/societies">Browse societies</Link>}
            icon="calendar"
            title="No upcoming events yet"
          >
            Events show here as soon as a society publishes them.
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {result.events.map((event) => (
              <div className={event.id === heroEventId ? "grid lg:hidden" : event.id === wideOnly ? "hidden lg:grid" : "grid"} key={event.id}>
                <EventCard
                  availability={event.availability}
                  id={event.id}
                  location={event.location}
                  society={event.organisation}
                  media={result.events.some((item) => item.heroAssetId)}
                  heroAssetId={event.heroAssetId}
                  startTime={event.startTime}
                  timeZone={event.organisation.timeZone}
                  title={event.title}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {societies.organisations.length > 0 ? (
        <section aria-labelledby="discover-societies" className="grid gap-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-2xl font-semibold text-ink" id="discover-societies">
              Discover societies
            </h2>
            <Link className={`text-sm ${quietLinkClasses}`} href="/societies">
              All societies
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {societies.organisations.map((society) => (
              <SocietyCard headingLevel="h3" key={society.id} {...society} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
