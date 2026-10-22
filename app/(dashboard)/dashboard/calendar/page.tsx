import Link from "next/link";
import { Suspense } from "react";
import { Agenda, MonthGrid, WeekGrid } from "@/components/calendar/calendar-views";
import { calendarItems, clockChanges, daysFrom, mondayOf, monthTitle } from "@/components/calendar/layout";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { addDays, localToday } from "@/lib/analytics/range";
import { requireManagementPage } from "@/lib/auth/page-access";
import { calendarEventCap, isLocalDate, readCalendar } from "@/lib/events/calendar";
import { formatDate, joinDays } from "@/lib/format";
import { readTimeZone } from "@/lib/organisations/profile";
import { hasOrganisationPermission, type OrganisationStaffRole } from "@/lib/permissions";
import { zoneAbbreviation, zoneCity } from "@/lib/zoned-time";

const views = { month: "Month", week: "Week", agenda: "Agenda" } as const;
type View = keyof typeof views;

const shiftMonth = (first: string, months: number) => {
  const date = new Date(`${first}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months, 1);
  return date.toISOString().slice(0, 10);
};

// /dashboard/calendar (T33, design round C1): the society's events by month,
// week or as an agenda, in the society's zone. Phones get the agenda only.
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const params = await searchParams;
  const organisation = await requireManagementPage("events:read", "/dashboard/calendar");
  const timeZone = await readTimeZone(organisation.id);
  const now = new Date();
  const today = localToday(timeZone, now);
  const view: View = params.view === "week" || params.view === "agenda" ? params.view : "month";
  const badDate = params.date !== undefined && !isLocalDate(params.date);
  const date = !badDate && params.date ? params.date : today;
  const canManage = hasOrganisationPermission(organisation.staffRole, "events:manage");

  // A week, or a month shown as whole Monday-to-Sunday weeks.
  const first = view === "week" ? mondayOf(date) : `${date.slice(0, 7)}-01`;
  const last = view === "week" ? addDays(first, 6) : addDays(shiftMonth(first, 1), -1);
  const gridFirst = mondayOf(first);
  const gridDays = daysFrom(gridFirst, Math.round((Date.parse(addDays(mondayOf(last), 7)) - Date.parse(gridFirst)) / 86_400_000));
  const step = view === "week" ? addDays(first, 7) : shiftMonth(first, 1);
  const back = view === "week" ? addDays(first, -7) : shiftMonth(first, -1);
  const href = (changes: { view?: View; date?: string }) => {
    const query = new URLSearchParams(Object.entries({ view, date, ...changes }).filter((entry): entry is [string, string] => Boolean(entry[1]) && entry[1] !== "month"));
    return `/dashboard/calendar${query.size ? `?${query}` : ""}`;
  };
  const noun = view === "week" ? "week" : "month";
  const title = view === "week" ? joinDays(formatDate(`${first}T12:00:00Z`, "UTC"), formatDate(`${last}T12:00:00Z`, "UTC")) : monthTitle(first);
  const navButton = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-[10px] border border-line-strong bg-surface px-3 text-sm font-semibold text-ink no-underline hover:border-brand";

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader
        actions={canManage ? <Link className={buttonClasses()} href="/dashboard/events/new">New event</Link> : null}
        badge={<span className="inline-flex h-7 items-center rounded-md bg-surface-subtle px-2.5 text-[13px] font-semibold text-ink-soft">{zoneCity(timeZone)} ({zoneAbbreviation(timeZone, now).split(",")[0]})</span>}
        title="Calendar"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Link className={navButton} href={href({ date: undefined })}>Today</Link>
          <Link aria-label={`Previous ${noun}`} className={navButton} href={href({ date: back })}><Icon name="chevronLeft" size={18} /></Link>
          <Link aria-label={`Next ${noun}`} className={navButton} href={href({ date: step })}><Icon name="chevronRight" size={18} /></Link>
          <h2 className="ml-2 text-xl font-semibold">{title}</h2>
        </div>
        <nav aria-label="Calendar view" className="hidden overflow-hidden rounded-[10px] border border-line bg-surface md:inline-flex">
          {(Object.keys(views) as View[]).map((name) => (
            <Link
              aria-current={name === view ? "page" : undefined}
              className={`inline-flex min-h-[42px] items-center border-l border-line px-4 text-sm font-semibold no-underline first:border-l-0 ${name === view ? "bg-brand-tint text-brand-ink" : "text-ink-soft hover:text-ink"}`}
              href={href({ view: name })}
              key={name}
            >
              {views[name]}
            </Link>
          ))}
        </nav>
      </div>
      {badDate ? (
        <Notice title={`Showing ${title}`} tone="warning">That link's date wasn't a real day, so the calendar opened on today.</Notice>
      ) : null}
      <Suspense
        fallback={
          <div className="grid gap-2">
            <p className="sr-only">Loading calendar</p>
            <Skeleton className="h-8" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        }
        key={href({})}
      >
        <CalendarBody
          agendaDays={daysFrom(first, Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000) + 1)}
          canManage={canManage}
          gridDays={view === "week" ? daysFrom(first, 7) : gridDays}
          next={{ href: href({ date: step }), label: view === "week" ? "Next week" : monthTitle(step) }}
          noun={noun}
          now={now}
          organisationId={organisation.id}
          emptyTitle={view === "week" ? "Nothing scheduled this week" : `Nothing scheduled in ${monthTitle(first).split(" ")[0]}`}
          staffRole={organisation.staffRole}
          timeZone={timeZone}
          today={today}
          view={view}
        />
      </Suspense>
      <p className="text-sm text-ink-soft">
        Each entry opens its event. Times and days are {zoneCity(timeZone)}, the society&apos;s zone. Weeks start on Monday.
      </p>
    </DashboardShell>
  );
}

async function CalendarBody(props: {
  organisationId: string;
  staffRole: OrganisationStaffRole;
  timeZone: string;
  today: string;
  now: Date;
  view: View;
  gridDays: string[];
  agendaDays: string[];
  noun: "month" | "week";
  emptyTitle: string;
  next: { href: string; label: string };
  canManage: boolean;
}) {
  const { timeZone, gridDays, agendaDays, view } = props;
  const { events, membershipEnds, truncated } = await readCalendar(props.organisationId, props.staffRole, { from: gridDays[0], to: gridDays[gridDays.length - 1] }, timeZone);
  const items = calendarItems(events, membershipEnds, timeZone, clockChanges(gridDays, timeZone));
  // Check-in staff land on the attendee list; everyone else on the summary.
  const summary = hasOrganisationPermission(props.staffRole, "analytics:read");
  const shared = {
    items,
    timeZone,
    today: props.today,
    eventHref: (id: string) => (summary ? `/dashboard/events/${id}` : `/dashboard/events/${id}/tickets`),
    newEventHref: props.canManage ? (day: string) => `/dashboard/events/new?date=${day}` : null
  };
  const empty = !items.some((item) => item.kind !== "clock" && item.lastDay >= agendaDays[0] && item.firstDay <= agendaDays[agendaDays.length - 1]);
  const showMembership = hasOrganisationPermission(props.staffRole, "members:read");

  return (
    <>
      {truncated ? <Notice title={`Showing the first ${calendarEventCap} events`} tone="warning">Pick a shorter period to see the rest.</Notice> : null}
      {empty ? (
        <EmptyState
          action={props.canManage ? <Link className={buttonClasses({ variant: "secondary" })} href={`/dashboard/events/new?date=${agendaDays[0] > props.today ? agendaDays[0] : props.today}`}>New event</Link> : null}
          icon="calendar"
          title={props.emptyTitle}
        >
          {props.canManage ? "Events and drafts you schedule show here." : "Published events show here."}
        </EmptyState>
      ) : null}
      {view !== "agenda" ? (
        <div className="hidden gap-4 md:grid">
          {view === "week" ? <WeekGrid days={gridDays} now={props.now} {...shared} /> : <MonthGrid days={gridDays} month={agendaDays[0].slice(0, 7)} {...shared} />}
          <div className="flex flex-wrap gap-4 text-sm text-ink-soft">
            <span className="inline-flex items-center gap-2"><i className="inline-block h-3.5 w-[22px] rounded border border-brand-200 bg-brand-tint" />Published</span>
            {props.canManage ? <span className="inline-flex items-center gap-2"><i className="inline-block h-3.5 w-[22px] rounded border border-dashed border-ink-muted bg-surface" />Draft</span> : null}
            {showMembership ? <span className="inline-flex items-center gap-2"><i className="inline-block h-3.5 w-[22px] rounded border border-line bg-surface-subtle" />Membership ends</span> : null}
          </div>
        </div>
      ) : null}
      <div className={`grid gap-5 ${view === "agenda" ? "" : "md:hidden"}`}>
        {empty ? null : <Agenda days={agendaDays} noun={props.noun} {...shared} />}
        <Link className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-line-strong bg-surface px-3 text-sm font-semibold text-ink no-underline hover:border-brand" href={props.next.href}>
          {props.next.label}
        </Link>
      </div>
    </>
  );
}
