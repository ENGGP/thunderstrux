import Link from "next/link";
import { Suspense } from "react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { FilterBar } from "@/components/ui/filter-bar";
import { Select, TextInput } from "@/components/ui/input";
import { LinkTabs } from "@/components/ui/link-tabs";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { analyticsAccess } from "@/lib/analytics/metrics";
import { addDays, AnalyticsRangeError, analyticsBuckets, analyticsRange, localToday, maxRangeDays, type AnalyticsRange } from "@/lib/analytics/range";
import { requireManagementPage } from "@/lib/auth/page-access";
import { listEventOptions } from "@/lib/events/event-lifecycle";
import { formatDate, formatDateTime } from "@/lib/format";
import { readTimeZone } from "@/lib/organisations/profile";
import { hasOrganisationPermission } from "@/lib/permissions";
import { zoneCity } from "@/lib/zoned-time";
import { EngagementTab, MembershipsTab, MerchandiseTab, TicketsTab } from "./analytics-tabs";

const tabNames = { tickets: "Tickets", memberships: "Memberships", merchandise: "Merchandise", engagement: "Engagement" } as const;
type Tab = keyof typeof tabNames;
type Params = { tab?: string; from?: string; to?: string; bucket?: string; eventId?: string };

// /dashboard/analytics (T32, design round C1): range, grouping and the
// society's zone live in the URL. Tickets and Engagement need analytics:read;
// Memberships, Merchandise and every money figure also need orders:read.
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const organisation = await requireManagementPage("analytics:read", "/dashboard/analytics");
  const access = analyticsAccess(organisation.staffRole);
  const tabs: Tab[] = access.financial ? ["tickets", "memberships", "merchandise", "engagement"] : ["tickets", "engagement"];
  const tab = tabs.find((name) => name === params.tab) ?? "tickets";
  const timeZone = await readTimeZone(organisation.id);
  const today = localToday(timeZone);

  let range: AnalyticsRange;
  let rangeError: string | null = null;
  try {
    range = analyticsRange(params, timeZone);
  } catch (error) {
    if (!(error instanceof AnalyticsRangeError)) throw error;
    rangeError = error.message;
    range = analyticsRange({}, timeZone);
  }
  const events = tab === "tickets" ? await listEventOptions(organisation.id) : [];
  // Only this society's events can filter; anything else is ignored.
  const event = events.find((option) => option.id === params.eventId);

  const href = (changes: Partial<Record<keyof Params, string | undefined>>) => {
    const values = { tab: tab === "tickets" ? undefined : tab, from: range.from, to: range.to, bucket: range.bucket, eventId: event?.id, ...changes };
    const query = new URLSearchParams(Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
    return `/dashboard/analytics${query ? `?${query}` : ""}`;
  };
  const quick = [
    { label: "Last 7 days", from: addDays(today, -6), bucket: "day" },
    { label: "Last 30 days", from: addDays(today, -29), bucket: "day" },
    { label: "This month", from: `${today.slice(0, 8)}01`, bucket: "day" },
    { label: "Last 12 months", from: addDays(today, -364), bucket: "month" }
  ];
  const asOf = range.to >= today ? "today" : formatDate(`${range.to}T12:00:00Z`, "UTC");
  const day = (date: string) => formatDate(`${date}T12:00:00Z`, "UTC");

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader
        description={`${day(range.from)} to ${day(range.to)}, by ${range.bucket}, in ${zoneCity(timeZone)}. Updated ${formatDateTime(new Date(), { timeZone })}.`}
        title="Analytics"
      />
      <LinkTabs
        label="Analytics sections"
        tabs={tabs.map((name) => ({ href: href({ tab: name === "tickets" ? undefined : name, eventId: name === "tickets" ? event?.id : undefined }), label: tabNames[name], active: name === tab }))}
      />
      <section aria-label="Range" className="grid gap-3.5 rounded-card border border-line bg-surface p-4">
        <nav aria-label="Quick ranges" className="flex flex-wrap gap-2">
          {quick.map((option) => {
            const current = option.from === range.from && range.to === today && option.bucket === range.bucket;
            return (
              <Link
                aria-current={current ? "page" : undefined}
                className={`inline-flex min-h-10 items-center rounded-full border px-3.5 text-sm font-semibold ${current ? "border-brand bg-brand-tint text-brand-ink" : "border-line bg-surface text-ink hover:text-brand-ink"}`}
                href={href({ from: option.from, to: today, bucket: option.bucket })}
                key={option.label}
              >
                {option.label}
              </Link>
            );
          })}
        </nav>
        <FilterBar action="/dashboard/analytics" key={href({})} className="sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.4fr)_auto]" label="Choose a range">
          {tab !== "tickets" ? <input name="tab" type="hidden" value={tab} /> : null}
          <TextInput defaultValue={range.from} label="From" name="from" type="date" />
          <TextInput defaultValue={range.to} label="To" name="to" type="date" />
          <Select defaultValue={range.bucket} label="Group by" name="bucket">
            {analyticsBuckets.map((bucket) => <option key={bucket} value={bucket}>{bucket.charAt(0).toUpperCase() + bucket.slice(1)}</option>)}
          </Select>
          {tab === "tickets" ? (
            <Select defaultValue={event?.id ?? ""} label="Event" name="eventId">
              <option value="">All events</option>
              {events.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
            </Select>
          ) : <span aria-hidden="true" />}
        </FilterBar>
        <p className="text-sm text-ink-muted">Up to {maxRangeDays} days. Weeks start on Monday.</p>
      </section>
      {rangeError ? (
        <Notice role="alert" title="Pick a shorter range" tone="danger">
          {rangeError}. Showing the last 30 days instead.
        </Notice>
      ) : null}
      {event ? (
        <p className="text-sm text-ink-soft">
          Event: {event.title}. <Link className="font-semibold text-brand underline underline-offset-4" href={href({ eventId: undefined })}>Clear event</Link> ·{" "}
          <Link className="font-semibold text-brand underline underline-offset-4" href={`/dashboard/events/${event.id}`}>Open its Summary</Link>
        </p>
      ) : null}
      <Suspense
        fallback={
          <div className="grid gap-6">
            <p className="sr-only">Loading analytics</p>
            <div className="grid gap-5 sm:grid-cols-3"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
            <Skeleton className="h-72" />
          </div>
        }
        key={href({})}
      >
        {tab === "tickets" ? <TicketsTab access={access} eventId={event?.id} organisationId={organisation.id} range={range} /> : null}
        {tab === "memberships" ? <MembershipsTab access={access} asOf={asOf} organisationId={organisation.id} range={range} /> : null}
        {tab === "merchandise" ? <MerchandiseTab access={access} canFulfil={hasOrganisationPermission(organisation.staffRole, "merchandise:fulfil")} organisationId={organisation.id} range={range} /> : null}
        {tab === "engagement" ? <EngagementTab asOf={asOf} organisationId={organisation.id} range={range} /> : null}
      </Suspense>
      <p className="text-sm text-ink-muted">Money shows to owners, admins and finance managers. Event managers see tickets, attendance and engagement.</p>
    </DashboardShell>
  );
}
