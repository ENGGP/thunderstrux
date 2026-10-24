import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { formatDay, formatTime, localDay } from "@/components/calendar/layout";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { DateField } from "@/components/ui/date-field";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Icon } from "@/components/ui/icon";
import { Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { localToday } from "@/lib/analytics/range";
import { HistoryCursorError, hasHistory, historyCategories, historyPeople, readHistory, type HistoryCategory, type HistoryEntry, type HistoryFilters } from "@/lib/audit/history";
import { requireManagementPage } from "@/lib/auth/page-access";
import { isLocalDate } from "@/lib/events/calendar";
import { readTimeZone } from "@/lib/organisations/profile";
import { zoneCity } from "@/lib/zoned-time";

export const metadata: Metadata = { title: "History" };

type Params = { category?: string; who?: string; from?: string; to?: string; cursor?: string };

// /dashboard/history (T38, design round C2): what staff, Stripe and
// Thunderstrux did in the society, newest first, for owners and admins.
export default async function HistoryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const organisation = await requireManagementPage("audit:read", "/dashboard/history");
  const timeZone = await readTimeZone(organisation.id);
  const people = await historyPeople(organisation.id);
  const category = (Object.keys(historyCategories) as HistoryCategory[]).find((name) => name === params.category);
  const who = params.who === "stripe" || params.who === "thunderstrux" || people.some((person) => person.id === params.who) ? params.who : undefined;
  const filters: HistoryFilters = { category, who, from: isLocalDate(params.from) ? params.from : undefined, to: isLocalDate(params.to) ? params.to : undefined };
  const filtered = Boolean(filters.category || filters.who || filters.from || filters.to);
  const query = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader description={`What staff, Stripe and Thunderstrux did in ${organisation.name}, newest first. ${zoneCity(timeZone)}.`} title="History" />
      <div className="rounded-card border border-line bg-surface p-4">
      <FilterBar action="/dashboard/history" className="sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" key={query} label="Filter history">
        <Select defaultValue={filters.category ?? ""} label="What" name="category">
          <option value="">All activity</option>
          {(Object.keys(historyCategories) as HistoryCategory[]).map((name) => (
            <option key={name} value={name}>{historyCategories[name]}</option>
          ))}
        </Select>
        <Select defaultValue={filters.who ?? ""} label="Who" name="who">
          <option value="">Anyone</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>{person.name}</option>
          ))}
          <option value="stripe">Stripe</option>
          <option value="thunderstrux">Thunderstrux</option>
        </Select>
        <DateField defaultValue={filters.from ?? ""} label="From" max={localToday(timeZone)} name="from" />
        <DateField defaultValue={filters.to ?? ""} label="To" max={localToday(timeZone)} name="to" />
      </FilterBar>
      </div>
      <p className="text-sm text-ink-muted">Check-ins have their own filter, so a busy door doesn&apos;t bury everything else.</p>
      <Suspense
        fallback={
          <div className="grid gap-3">
            <p className="sr-only">Loading history</p>
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        }
        key={`${query}|${params.cursor ?? ""}`}
      >
        <HistoryList cursor={params.cursor} filtered={filtered} filters={filters} organisationId={organisation.id} query={query} timeZone={timeZone} />
      </Suspense>
      <p className="text-sm text-ink-muted">
        History is for handovers and accountability, not accounting: amounts link to their orders, which hold the full record. It never shows buyers&apos; email addresses, card details or what Stripe sends. Owners and admins see this page.
      </p>
    </DashboardShell>
  );
}

async function HistoryList({ organisationId, filters, filtered, timeZone, cursor, query }: { organisationId: string; filters: HistoryFilters; filtered: boolean; timeZone: string; cursor?: string; query: string }) {
  let page: Awaited<ReturnType<typeof readHistory>>;
  let restarted = false;
  try {
    page = await readHistory(organisationId, filters, timeZone, cursor);
  } catch (error) {
    if (!(error instanceof HistoryCursorError)) throw error;
    page = await readHistory(organisationId, filters, timeZone);
    restarted = true;
  }

  if (page.entries.length === 0) {
    if (!filtered && !cursor && !(await hasHistory(organisationId))) {
      return (
        <EmptyState icon="clock" title="Nothing recorded yet">
          When staff publish events, refund orders or change roles, it shows here with who did it and when.
        </EmptyState>
      );
    }
    return (
      <EmptyState action={<Link className="font-semibold text-brand underline underline-offset-4" href="/dashboard/history">Clear filters</Link>} icon="search" title="No matches">
        Nothing matches these filters. Try a wider range, or anyone.
      </EmptyState>
    );
  }

  const today = localToday(timeZone);
  const days: Array<{ day: string; entries: HistoryEntry[] }> = [];
  for (const entry of page.entries) {
    const day = localDay(entry.at, timeZone);
    if (days.at(-1)?.day !== day) days.push({ day, entries: [] });
    days.at(-1)!.entries.push(entry);
  }
  const older = page.nextCursor ? `/dashboard/history?${new URLSearchParams([...new URLSearchParams(query), ["cursor", page.nextCursor]])}` : null;

  return (
    <div className="grid gap-2">
      {restarted ? <Notice title="Showing the newest entries" tone="warning">That page of History is no longer available, so it starts again from the newest.</Notice> : null}
      {days.map(({ day, entries }) => (
        <section aria-labelledby={`day-${day}`} key={day}>
          <h2 className={`pb-2 pt-4 text-[15px] font-semibold ${day === today ? "text-brand-ink" : "text-ink-soft"}`} id={`day-${day}`}>
            {day === today ? `Today · ${formatDay(day)}` : formatDay(day)}
          </h2>
          <ol className="relative before:absolute before:bottom-1.5 before:left-[18px] before:top-1.5 before:w-0.5 before:bg-line md:before:left-[103px]">
            {entries.map((entry) => <HistoryItem entry={entry} key={entry.id} timeZone={timeZone} />)}
          </ol>
        </section>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        {older ? (
          <>
            <p className="text-sm text-ink-muted">Showing up to 50 at a time.</p>
            <Link className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold text-ink hover:border-brand" href={older}>
              Older entries
            </Link>
          </>
        ) : (
          <div className="flex items-start gap-3 rounded-control border border-line bg-surface px-4 py-3.5">
            <Icon className="mt-0.5 text-brand" name="info" />
            <div>
              <p className="font-semibold text-ink">{filtered ? "That's everything that matches" : "That's the start of the society's history"}</p>
              <p className="text-sm text-ink-soft">Some actions from before History was added weren&apos;t recorded. Orders still hold their own full record.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryItem({ entry, timeZone }: { entry: HistoryEntry; timeZone: string }) {
  const dot =
    entry.actor.kind === "person"
      ? "bg-brand-ink text-white"
      : entry.actor.kind === "former"
        ? "border border-dashed border-line-strong bg-surface-subtle text-ink-muted"
        : entry.actor.kind === "stripe"
          ? "bg-ink text-white"
          : "border border-line bg-surface text-brand";
  return (
    <li className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-x-3.5 py-3 md:grid-cols-[80px_36px_minmax(0,1fr)_172px] md:gap-x-0">
      <span className="hidden pr-4 pt-2 text-right text-sm font-semibold tabular-nums text-ink md:block">{formatTime(entry.at, timeZone)}</span>
      <span aria-hidden="true" className={`relative z-[1] flex size-9 items-center justify-center rounded-full text-[13px] font-semibold shadow-[0_0_0_4px_var(--color-paper)] ${dot}`}>
        {entry.actor.kind === "thunderstrux" ? <Icon name="zap" size={18} /> : entry.actor.kind === "former" ? <Icon name="user" size={18} /> : entry.actor.initials}
      </span>
      <div className="grid min-w-0 gap-1.5 md:pl-3.5">
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-muted md:hidden">
          <strong className="text-sm tabular-nums text-ink">{formatTime(entry.at, timeZone)}</strong>
          {entry.category ? <span className="rounded-tag border border-line bg-surface-subtle px-1.5 text-xs font-semibold leading-[22px] text-ink-soft">{historyCategories[entry.category]}</span> : null}
        </p>
        <p className="text-base text-ink [overflow-wrap:anywhere]">
          <b className="font-semibold">{entry.actor.name}</b>
          {entry.actor.role ? <span className="text-sm text-ink-muted"> {entry.actor.role}</span> : null}{" "}
          {entry.sentence.map((part, index) =>
            typeof part === "string" ? (
              <span key={index}>{part}</span>
            ) : part.href ? (
              <Link className="font-medium text-brand underline-offset-4 hover:underline" href={part.href} key={index}>{part.text}</Link>
            ) : (
              <span className="font-medium" key={index}>{part.text}</span>
            )
          )}
        </p>
        {entry.detailUnavailable ? (
          <p className="rounded-control border border-dashed border-line-strong bg-surface-subtle px-3 py-2 text-sm text-ink-soft">
            Historical detail unavailable. This change was recorded before History kept what changed.
          </p>
        ) : entry.facts.length ? (
          <dl className="grid gap-1 rounded-control border border-line bg-surface px-3.5 py-2.5 text-sm">
            {entry.facts.map((fact, index) => (
              <div className="flex flex-wrap gap-x-2" key={index}>
                <dt className="min-w-24 text-ink-soft">{fact.label}</dt>
                <dd className="font-medium text-ink [overflow-wrap:anywhere]">
                  {fact.was !== undefined ? (
                    <>
                      <span className="text-ink-muted line-through">{fact.was}</span>
                      <span className="sr-only"> changed to </span>
                      <span aria-hidden="true"> → </span>
                    </>
                  ) : null}
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      {entry.category ? (
        <span className={`mt-1.5 hidden self-start justify-self-end rounded-tag border px-2 text-xs font-semibold leading-[22px] md:inline-block ${entry.category === "orders" ? "border-warning-border bg-warning-bg text-warning" : "border-line bg-surface-subtle text-ink-soft"}`}>
          {historyCategories[entry.category]}
        </span>
      ) : null}
    </li>
  );
}
