import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { EventActions } from "@/components/events/event-actions";
import { tabBarClasses, tabClasses } from "@/components/events/event-tabs";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Button, buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { TextInput } from "@/components/ui/input";
import { ListSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireManagementPage } from "@/lib/auth/page-access";
import {
  eventViews,
  listDashboardEvents,
  type DashboardEvent,
  type EventView
} from "@/lib/events/event-lifecycle";
import { formatDateTime } from "@/lib/format";
import { hasOrganisationPermission, type OrganisationStaffRole } from "@/lib/permissions";

const viewLabels: Record<EventView, string> = {
  upcoming: "Upcoming",
  drafts: "Drafts",
  past: "Past",
  all: "All"
};
const viewNouns: Record<EventView, [string, string]> = {
  upcoming: ["upcoming event", "upcoming events"],
  drafts: ["draft", "drafts"],
  past: ["past event", "past events"],
  all: ["event", "events"]
};

function viewHref(view: EventView, query: string) {
  const params = new URLSearchParams();
  if (view !== "upcoming") params.set("view", view);
  if (query) params.set("q", query);
  const search = params.toString();
  return search ? `/dashboard/events?${search}` : "/dashboard/events";
}

export default async function EventsPage({
  searchParams
}: {
  searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const organisation = await requireManagementPage("events:read", "/dashboard/events");
  const params = await searchParams;
  // Check-in staff only ever see published events, so they get no Drafts view.
  const views = eventViews.filter(
    (view) => view !== "drafts" || organisation.staffRole !== "check_in_staff"
  );
  const view = views.find((name) => name === params.view) ?? "upcoming";
  const query = params.q?.trim().slice(0, 100) ?? "";

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader
        actions={
          hasOrganisationPermission(organisation.staffRole, "events:manage") ? (
            <Link className={buttonClasses()} href="/dashboard/events/new">
              New event
            </Link>
          ) : null
        }
        title="Events"
      />
      <Suspense fallback={<ListSkeleton label="Loading events" />}>
        <EventsResults
          organisationId={organisation.id}
          query={query}
          staffRole={organisation.staffRole}
          view={view}
          views={views}
        />
      </Suspense>
    </DashboardShell>
  );
}

async function EventsResults({
  organisationId,
  staffRole,
  view,
  views,
  query
}: {
  organisationId: string;
  staffRole: OrganisationStaffRole;
  view: EventView;
  views: EventView[];
  query: string;
}) {
  const canManage = hasOrganisationPermission(staffRole, "events:manage");
  const showSales = hasOrganisationPermission(staffRole, "analytics:read");
  const { events, counts } = await listDashboardEvents(organisationId, {
    view,
    query,
    publishedOnly: staffRole === "check_in_staff",
    includeSales: showSales
  });
  // Check-in staff land on the attendee list; everyone else on the summary.
  const eventHref = (event: DashboardEvent) =>
    showSales ? `/dashboard/events/${event.id}` : `/dashboard/events/${event.id}/tickets`;
  const tickets = (event: DashboardEvent & { sold: number | null }) =>
    event.ticketTypeCount === 0 ? "No ticket types" : `${event.sold} sold · ${event.remaining} left`;
  const [singular, plural] = viewNouns[view];
  const titleLink = "font-semibold text-ink underline-offset-4 hover:underline [overflow-wrap:anywhere]";

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <nav aria-label="Event views" className={`max-w-full ${tabBarClasses}`}>
          {views.map((name) => (
            <Link
              aria-current={name === view ? "page" : undefined}
              className={tabClasses(name === view)}
              href={viewHref(name, query)}
              key={name}
            >
              {viewLabels[name]}
              <span
                className={`rounded-md px-2 text-[13px] font-semibold tabular-nums ${
                  name === view ? "bg-brand-tint" : "bg-surface-subtle"
                }`}
              >
                {counts[name]}
              </span>
            </Link>
          ))}
        </nav>
        <Form action="/dashboard/events" className="flex w-full items-end gap-2 sm:w-auto" role="search">
          {view !== "upcoming" ? <input name="view" type="hidden" value={view} /> : null}
          <div className="flex-1 sm:w-72">
            <TextInput defaultValue={query} label="Search events" name="q" placeholder="Search by title" type="search" />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </Form>
      </div>

      {events.length === 0 ? (
        <div className="grid justify-items-center gap-3 rounded-card border border-line bg-surface px-6 py-12 text-center">
          <Icon className={query ? "text-ink-soft" : "text-brand"} name={query ? "search" : "calendar"} size={36} />
          <h2 className="text-lg font-semibold text-ink [overflow-wrap:anywhere]">
            {query ? `No ${plural} match “${query}”` : `No ${plural}`}
          </h2>
          {query ? (
            <>
              <p className="text-ink-soft">Check the spelling, try another view, or clear the search.</p>
              <Link className="font-semibold text-brand underline underline-offset-4" href={viewHref(view, "")}>
                Clear search
              </Link>
            </>
          ) : canManage ? (
            <>
              <p className="max-w-md text-ink-soft">
                Create an event and add ticket types. It stays a draft until you publish it.
              </p>
              <Link className={buttonClasses()} href="/dashboard/events/new">
                Create event
              </Link>
            </>
          ) : null}
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
            <table className="w-full min-w-[720px] border-collapse text-left text-[15px]">
              <thead>
                <tr className="text-[13px] text-ink-soft">
                  <th className="px-5 py-3.5 font-semibold" scope="col">Event</th>
                  <th className="px-3 py-3.5 font-semibold" scope="col">Starts</th>
                  <th className="px-3 py-3.5 font-semibold" scope="col">Status</th>
                  {showSales ? <th className="px-3 py-3.5 font-semibold" scope="col">Tickets</th> : null}
                  {canManage ? <th className="px-5 py-3.5 text-right font-semibold" scope="col">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr className="border-t border-line align-top" key={event.id}>
                    <td className="px-5 py-4">
                      <Link className={titleLink} href={eventHref(event)}>
                        {event.title}
                      </Link>
                      <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{event.location}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-4">{formatDateTime(event.startTime)}</td>
                    <td className="px-3 py-4">
                      <StatusBadge status={event.status} />
                    </td>
                    {showSales ? (
                      <td className="whitespace-nowrap px-3 py-4 tabular-nums">{tickets(event)}</td>
                    ) : null}
                    {canManage ? (
                      <td className="px-5 py-4">
                        <div className="flex justify-end">
                          <EventActions event={event} />
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="grid gap-4 md:hidden">
            {events.map((event) => (
              <li className="grid gap-2 rounded-card border border-line bg-surface p-5" key={event.id}>
                <div className="flex items-start justify-between gap-3">
                  <Link className={titleLink} href={eventHref(event)}>
                    {event.title}
                  </Link>
                  <StatusBadge status={event.status} />
                </div>
                <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
                  {formatDateTime(event.startTime)} · {event.location}
                </p>
                {showSales ? <p className="text-sm tabular-nums">{tickets(event)}</p> : null}
                {canManage ? <EventActions event={event} size="md" /> : null}
              </li>
            ))}
          </ul>
        </>
      )}

      {events.length > 0 ? (
        <p className="text-sm text-ink-soft">
          Showing {events.length}
          {counts[view] > events.length ? ` of ${counts[view]}` : ""}{" "}
          {counts[view] === 1 ? singular : plural}. Times are shown in Brisbane time.
        </p>
      ) : null}
    </>
  );
}
