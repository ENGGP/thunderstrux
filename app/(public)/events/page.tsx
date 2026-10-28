import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EventCard } from "@/components/events/event-card";
import { ExploreFilterFields } from "@/components/events/explore-filter-fields";
import { buttonClasses } from "@/components/ui/button";
import { Pager } from "@/components/ui/pager";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { TextInput } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { CardGridSkeleton } from "@/components/ui/skeleton";
import { maxSearchLength, parseExploreFilters, whenOptions, type ExploreFilters, type ExploreRange } from "@/lib/events/explore-filters";
import { getExploreSocieties, getPublishedEvents } from "@/lib/events/public-events";
import { formatDate } from "@/lib/format";
import { logError } from "@/lib/ops/logger";
import { PaginationError, parsePaginationOptionsOrDefault } from "@/lib/pagination/cursor";

export const metadata: Metadata = { title: "Explore events" };

export const dynamic = "force-dynamic";

const pageSize = 20;
type Params = Partial<Record<"q" | "when" | "from" | "to" | "society" | "cursor" | "direction", string>>;

export default async function ExploreEventsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const now = new Date();
  const { filters, errors, range } = parseExploreFilters(params, now);
  const societies = await getExploreSocieties(now);
  if (filters.society && !societies.some((society) => society.slug === filters.society)) {
    errors.society = "Choose a society from the list.";
  }
  const valid = Object.keys(errors).length === 0;

  return (
    <main id="main" tabIndex={-1} className="bg-paper">
      <div className="mx-auto grid max-w-page gap-6 px-4 py-10 md:px-8 md:py-14">
        <header className="grid gap-2">
          <h1 className="font-display text-4xl font-semibold text-brand-ink">Explore events</h1>
          <p className="text-lg text-ink-soft">Public events from every society on Thunderstrux.</p>
        </header>

        <FilterBar
          action="/events"
          className="rounded-card border border-line bg-surface p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto]"
          label="Filter events"
          submitLabel="Show events"
        >
          <TextInput defaultValue={filters.q} error={errors.q} label="Search by title" maxLength={maxSearchLength} name="q" type="search" />
          <ExploreFilterFields errors={errors} filters={filters} societies={societies} />
        </FilterBar>

        {valid ? (
          <Suspense fallback={<CardGridSkeleton label="Loading events" />} key={JSON.stringify(params)}>
            <ExploreResults filters={filters} params={params} range={range} societyName={societies.find((s) => s.slug === filters.society)?.name} />
          </Suspense>
        ) : (
          <Notice tone="warning">Fix the highlighted filter to see events.</Notice>
        )}
      </div>
    </main>
  );
}

function describe(filters: ExploreFilters, societyName?: string) {
  const when =
    filters.when === "custom"
      ? `Events from ${formatDate(filters.from, "UTC")} to ${formatDate(filters.to, "UTC")}`
      : filters.when === "upcoming"
        ? "Upcoming events"
        : `Events ${whenOptions.find((option) => option.value === filters.when)?.label.toLowerCase()}`;
  return `${when}${societyName ? ` from ${societyName}` : ""}${filters.q ? ` with “${filters.q}” in the title` : ""}, soonest first.`;
}

async function ExploreResults({
  filters,
  params,
  range,
  societyName
}: {
  filters: ExploreFilters;
  params: Params;
  range: ExploreRange;
  societyName?: string;
}) {
  // A stale or edited page cursor falls back to the first page.
  const pagination = parsePaginationOptionsOrDefault(
    new URLSearchParams(Object.entries({ cursor: params.cursor, direction: params.direction }).filter((entry): entry is [string, string] => Boolean(entry[1]))),
    { defaultLimit: pageSize, maxLimit: pageSize }
  );
  const load = (page: { cursor?: string; direction?: "next" | "prev" }) =>
    getPublishedEvents({ ...page, limit: pageSize, title: filters.q || undefined, societySlug: filters.society || undefined, ...range });
  let invalidPage = pagination.invalid;
  let result;
  try {
    result = await load(pagination).catch((error) => {
      if (!(error instanceof PaginationError)) throw error;
      invalidPage = true;
      return load({});
    });
  } catch (error) {
    logError("explore_events.list_failed", { error });
    return (
      <Notice action={<Link className="font-semibold text-brand underline" href={hrefFor(filters, {})}>Try again</Link>} role="alert" tone="danger" title="We couldn't load events">
        Something went wrong on our side. Your filters are kept.
      </Notice>
    );
  }

  const filtered = Boolean(filters.q || filters.society || filters.when !== "upcoming");
  if (result.events.length === 0 && !result.pageInfo.hasPreviousPage) {
    return filtered ? (
      <EmptyState action={<Link className={buttonClasses({ variant: "secondary" })} href="/events">Clear filters</Link>} title="No events match these filters">
        Try a wider date range or another search.
      </EmptyState>
    ) : (
      <EmptyState action={<Link className={buttonClasses({ variant: "secondary" })} href="/societies">Explore societies</Link>} icon="calendar" title="No upcoming events yet">
        Events show here as soon as a society publishes them.
      </EmptyState>
    );
  }

  return (
    <section aria-label="Events" className="grid gap-6">
      {invalidPage ? <Notice tone="warning">That page link has expired, so this is the first page.</Notice> : null}
      <h2 className="font-sans text-base font-normal tracking-normal text-ink-soft">{describe(filters, societyName)}</h2>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {result.events.map((event) => (
          <EventCard
            availability={event.availability}
            media={result.events.some((item) => item.heroAssetId)}
            heroAssetId={event.heroAssetId}
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
      <Pager
        label="Pages of events"
        next={result.pageInfo.nextCursor && hrefFor(filters, { cursor: result.pageInfo.nextCursor, direction: "next" })}
        nextLabel="Later events"
        previous={result.pageInfo.previousCursor && hrefFor(filters, { cursor: result.pageInfo.previousCursor, direction: "prev" })}
        previousLabel="Earlier events"
      />
    </section>
  );
}

// The same filters with a page cursor, leaving out anything at its default.
function hrefFor(filters: ExploreFilters, page: { cursor?: string; direction?: string }) {
  const query = new URLSearchParams();
  if (filters.q) query.set("q", filters.q);
  if (filters.when !== "upcoming") query.set("when", filters.when);
  if (filters.when === "custom") {
    query.set("from", filters.from);
    query.set("to", filters.to);
  }
  if (filters.society) query.set("society", filters.society);
  if (page.cursor) query.set("cursor", page.cursor);
  if (page.direction) query.set("direction", page.direction);
  const search = query.toString();
  return search ? `/events?${search}` : "/events";
}
