import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EventWorkspaceHeader, SaleBadge } from "@/components/events/event-tabs";
import { ReadinessChecklist } from "@/components/events/readiness-checklist";
import { BarChart } from "@/components/analytics/bar-chart";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireManagementPage } from "@/lib/auth/page-access";
import { analyticsAccess, eventSalesDays, eventTicketTypeMetrics, ticketAttendance, ticketMetrics, type AnalyticsAccess } from "@/lib/analytics/metrics";
import { addDays, maxRangeDays } from "@/lib/analytics/range";
import { EventLifecycleNotFoundError, getDashboardEvent } from "@/lib/events/event-lifecycle";
import { formatDateTime, formatMoney, formatPrice, shortMonths } from "@/lib/format";
import { hasOrganisationPermission } from "@/lib/permissions";
import { zoneCity } from "@/lib/zoned-time";

type OrganiserEventPageProps = {
  params: Promise<{
    eventId: string;
  }>;
};

function formatShortDate(value: string) {
  return shortMonths(new Intl.DateTimeFormat("en-AU", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00.000Z`)));
}

export default async function OrganiserEventPage({
  params
}: OrganiserEventPageProps) {
  const { eventId } = await params;
  const organisation = await requireManagementPage("analytics:read", `/dashboard/events/${eventId}`);
  const access = analyticsAccess(organisation.staffRole);
  const financial = access.financial;
  const canManage = hasOrganisationPermission(organisation.staffRole, "events:manage");
  let event: Awaited<ReturnType<typeof getDashboardEvent>>;

  // The event read decides the 404 before anything streams; the metrics are
  // scoped to the same society.
  try {
    event = await getDashboardEvent(organisation.id, eventId);
  } catch (error) {
    if (error instanceof EventLifecycleNotFoundError) notFound();
    throw error;
  }
  const [ticketTypes, attendance] = await Promise.all([
    eventTicketTypeMetrics(organisation.id, event.id, access),
    ticketAttendance(organisation.id, { eventId: event.id })
  ]);
  const total = (key: "issued" | "valid" | "free" | "remaining") => ticketTypes.reduce((sum, type) => sum + type[key], 0);
  const money = (key: "gross" | "refunded" | "net") => ticketTypes.reduce((sum, type) => sum + (type[key] ?? 0), 0);
  const issued = total("issued");
  const free = total("free");
  const noLongerValid = issued - total("valid");
  const { checkedIn, checkInRate, valid } = attendance;

  const tiles = [
    {
      label: "Tickets sold",
      value: issued,
      note: [free > 0 ? `${issued - free} paid, ${free} free` : "Issued on completed orders", noLongerValid > 0 ? `${noLongerValid} no longer valid` : ""].filter(Boolean).join(" · ")
    },
    {
      label: "Tickets left",
      value: total("remaining"),
      note: `Across ${ticketTypes.length} ticket ${ticketTypes.length === 1 ? "type" : "types"}`
    },
    ...(event.capacity !== null
      ? [{ label: "Capacity", value: `${event.occupancy} of ${event.capacity}`, note: "Issued tickets plus live checkout holds" }]
      : []),
    {
      label: "Checked in",
      value: checkInRate === null ? 0 : `${checkedIn} of ${valid}`,
      note: checkInRate === null ? "Rate not applicable: no valid tickets yet" : `${Math.round(checkInRate * 100)}% of valid tickets`
    },
    ...(financial
      ? [{
          label: "Net sales",
          value: formatMoney(money("net")),
          note: money("refunded") > 0 ? `${formatMoney(money("gross"))} gross, ${formatMoney(money("refunded"))} refunded, before fees` : "Gross, before fees"
        }]
      : [])
  ];

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <EventWorkspaceHeader active="summary" event={event} staffRole={organisation.staffRole} />

      <div className="grid gap-6 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <p className="text-sm font-semibold text-ink-soft">{tile.label}</p>
            <p className="mt-1.5 text-[28px] font-semibold leading-tight tabular-nums text-ink">{tile.value}</p>
            <p className="mt-1 text-sm text-ink-muted">{tile.note}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold text-ink">Ticket performance</h2>
          {ticketTypes.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">No ticket types yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-[15px]">
                <thead>
                  <tr className="text-left text-[13px] text-ink-soft">
                    <th className="py-2.5 font-semibold" scope="col">Ticket</th>
                    <th className="px-2 py-2.5 text-right font-semibold" scope="col">Price</th>
                    <th className="px-2 py-2.5 text-right font-semibold" scope="col">Sold</th>
                    <th className="px-2 py-2.5 text-right font-semibold" scope="col">Held</th>
                    <th className="px-2 py-2.5 text-right font-semibold" scope="col">Left</th>
                    {financial ? (
                      <>
                        <th className="px-2 py-2.5 text-right font-semibold" scope="col">Revenue</th>
                        <th className="py-2.5 pl-2 text-right font-semibold" scope="col">Share</th>
                      </>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {ticketTypes.map((ticketType) => (
                    <tr className="border-t border-line" key={ticketType.id}>
                      <th className="py-3.5 text-left font-semibold text-ink [overflow-wrap:anywhere]" scope="row">
                        {ticketType.name}
                      </th>
                      <td className="px-2 py-3.5 text-right">{formatPrice(ticketType.price)}</td>
                      <td className="px-2 py-3.5 text-right">{ticketType.issued}</td>
                      <td className="px-2 py-3.5 text-right">{event.heldByType[ticketType.id] ?? 0}</td>
                      <td className="px-2 py-3.5 text-right">{ticketType.remaining}</td>
                      {financial ? (
                        <>
                          <td className="px-2 py-3.5 text-right">{formatMoney(ticketType.gross ?? 0)}</td>
                          <td className="py-3.5 pl-2 text-right">
                            {money("gross") > 0 ? Math.round(((ticketType.gross ?? 0) / money("gross")) * 100) : 0}%
                          </td>
                        </>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {financial ? (
          <Card>
            <h2 className="text-lg font-semibold text-ink">Sales over time</h2>
            <p className="text-sm text-ink-muted">Gross paid sales by the day they completed, in {zoneCity(event.timeZone)}</p>
            <Suspense
              fallback={
                <div className="mt-4">
                  <p className="sr-only">Loading sales over time</p>
                  <Skeleton className="h-48" />
                </div>
              }
            >
              <SalesOverTime access={access} eventId={event.id} organisationId={organisation.id} timeZone={event.timeZone} />
            </Suspense>
          </Card>
        ) : null}
      </div>

      {event.status === "draft" ? (
        <Card>
          <h2 className="text-lg font-semibold text-ink">Ready to publish?</h2>
          <div className="mt-3">
            <ReadinessChecklist
              blockers={event.blockers}
              editHref={canManage ? `/dashboard/events/${event.id}/edit` : undefined}
            />
          </div>
        </Card>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold text-ink">Selling status</h2>
            <SaleBadge event={event} />
          </div>
          <ul className="mt-3 grid list-disc gap-2 pl-5 text-[15px] text-ink">
            <li>
              {event.visibility === "unlisted"
                ? "Published, link only: not listed on Explore events"
                : event.visibility === "members_only"
                  ? "Published, members only: not listed; only members whose membership unlocks members-only events can see it"
                  : "Published and listed publicly"}
            </li>
            {event.blockers
              .filter((blocker) => ["payments_unavailable", "sold_out", "no_stock"].includes(blocker.code))
              .map((blocker) => (
                <li className="text-warning" key={blocker.code}>{blocker.message}</li>
              ))}
            <li>
              {event.saleState === "closed"
                ? "Sales were closed by staff. Use More to reopen them."
                : event.salesOpen
                  ? `Sales close automatically at ${formatDateTime(event.salesCloseAt, { timeZone: event.timeZone })}. Use More to close them sooner.`
                  : "Sales closed at the close time."}
            </li>
          </ul>
        </Card>
      )}

      <Card>
        <h2 className="text-lg font-semibold text-ink">About this event</h2>
        <p className="mt-2 max-w-3xl whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">
          {event.description}
        </p>
      </Card>
    </DashboardShell>
  );
}

// Zero-filled from the first paid sale to the last: by day, or by week past
// two months, over at most the last 366 days.
async function SalesOverTime({ access, organisationId, eventId, timeZone }: { access: AnalyticsAccess; organisationId: string; eventId: string; timeZone: string }) {
  const days = await eventSalesDays(organisationId, eventId, timeZone);
  if (!days) return <p className="mt-4 text-sm text-ink-soft">No paid sales yet.</p>;
  const earliest = addDays(days.last, 1 - maxRangeDays);
  const from = days.first > earliest ? days.first : earliest;
  const weekly = from < addDays(days.last, -62);
  const { series } = await ticketMetrics(organisationId, { from, to: days.last, bucket: weekly ? "week" : "day", timeZone }, access, eventId);
  return (
    <div className="mt-4">
      <BarChart
        bars={series.map((bucket) => ({ key: bucket.start, label: formatShortDate(bucket.start), primary: bucket.gross ?? 0, value: formatMoney(bucket.gross ?? 0) }))}
        label={`Gross sales by ${weekly ? "week starting" : "day"}`}
      />
    </div>
  );
}
