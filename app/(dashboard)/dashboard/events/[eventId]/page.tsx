import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EventWorkspaceHeader } from "@/components/events/event-tabs";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireManagementPage } from "@/lib/auth/page-access";
import {
  EventAnalyticsAccessError,
  getOrganisationEventAnalytics,
  getOrganisationEventRevenueSeries
} from "@/lib/events/event-analytics";
import { EventLifecycleNotFoundError, getDashboardEvent } from "@/lib/events/event-lifecycle";
import { formatMoney } from "@/lib/format";
import { hasOrganisationPermission } from "@/lib/permissions";

type OrganiserEventPageProps = {
  params: Promise<{
    eventId: string;
  }>;
};

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export default async function OrganiserEventPage({
  params
}: OrganiserEventPageProps) {
  const { eventId } = await params;
  const organisation = await requireManagementPage("analytics:read", `/dashboard/events/${eventId}`);
  const financial = hasOrganisationPermission(organisation.staffRole, "orders:read");
  let analytics: Awaited<ReturnType<typeof getOrganisationEventAnalytics>>;
  let event: Awaited<ReturnType<typeof getDashboardEvent>>;

  // Both reads decide the 404, so they finish before anything streams.
  try {
    [analytics, event] = await Promise.all([
      getOrganisationEventAnalytics(organisation.id, eventId),
      getDashboardEvent(organisation.id, eventId)
    ]);
  } catch (error) {
    if (error instanceof EventAnalyticsAccessError || error instanceof EventLifecycleNotFoundError) {
      notFound();
    }

    throw error;
  }

  const tiles = [
    { label: "Tickets sold", value: analytics.totals.sold, note: "From paid orders" },
    {
      label: "Tickets left",
      value: analytics.totals.remaining,
      note: `Across ${analytics.ticketTypes.length} ticket ${analytics.ticketTypes.length === 1 ? "type" : "types"}`
    },
    ...(financial
      ? [{ label: "Revenue", value: formatMoney(analytics.totals.revenue ?? 0), note: "Gross, before fees and refunds" }]
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
          {analytics.ticketTypes.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">No ticket types yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-[15px]">
                <thead>
                  <tr className="text-left text-[13px] text-ink-soft">
                    <th className="py-2.5 font-semibold" scope="col">Ticket</th>
                    <th className="px-2 py-2.5 text-right font-semibold" scope="col">Sold</th>
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
                  {analytics.ticketTypes.map((ticketType) => (
                    <tr className="border-t border-line" key={ticketType.id}>
                      <th className="py-3.5 text-left font-semibold text-ink [overflow-wrap:anywhere]" scope="row">
                        {ticketType.name}
                      </th>
                      <td className="px-2 py-3.5 text-right">{ticketType.sold}</td>
                      <td className="px-2 py-3.5 text-right">{ticketType.remaining}</td>
                      {financial ? (
                        <>
                          <td className="px-2 py-3.5 text-right">{formatMoney(ticketType.revenue ?? 0)}</td>
                          <td className="py-3.5 pl-2 text-right">
                            {(analytics.totals.revenue ?? 0) > 0
                              ? Math.round(((ticketType.revenue ?? 0) / (analytics.totals.revenue ?? 1)) * 100)
                              : 0}
                            %
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
            <h2 className="text-lg font-semibold text-ink">Revenue by day</h2>
            <p className="text-sm text-ink-muted">Paid orders, with days counted in UTC</p>
            <Suspense
              fallback={
                <div className="mt-4">
                  <p className="sr-only">Loading revenue by day</p>
                  <Skeleton className="h-48" />
                </div>
              }
            >
              <RevenueByDay eventId={analytics.event.id} organisationId={organisation.id} />
            </Suspense>
          </Card>
        ) : null}
      </div>

      <Card>
        <h2 className="text-lg font-semibold text-ink">About this event</h2>
        <p className="mt-2 max-w-3xl whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">
          {analytics.event.description}
        </p>
      </Card>
    </DashboardShell>
  );
}

async function RevenueByDay({ organisationId, eventId }: { organisationId: string; eventId: string }) {
  const series = await getOrganisationEventRevenueSeries(organisationId, eventId);
  const max = Math.max(...series.map((bucket) => bucket.revenue), 1);

  if (series.length === 0) {
    return <p className="mt-4 text-sm text-ink-soft">No revenue yet.</p>;
  }

  return (
    <div
      aria-label={`Revenue by day: ${series
        .map((bucket) => `${formatShortDate(bucket.date)} ${formatMoney(bucket.revenue)}`)
        .join(", ")}`}
      className="mt-4 flex h-52 items-end gap-3 overflow-x-auto pb-1"
      role="img"
    >
      {series.map((bucket) => (
        <div className="flex min-w-12 max-w-24 flex-1 flex-col items-center gap-1.5" key={bucket.date}>
          <span className="text-[13px] tabular-nums text-ink-soft">{formatMoney(bucket.revenue)}</span>
          <div
            className="w-full rounded-t-md bg-brand"
            style={{ height: `${Math.max(4, (bucket.revenue / max) * 140)}px` }}
          />
          <span className="text-[13px] text-ink-soft">{formatShortDate(bucket.date)}</span>
        </div>
      ))}
    </div>
  );
}
