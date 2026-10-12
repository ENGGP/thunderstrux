import { hasOrganisationPermission } from "@/lib/permissions";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { requireManagementPage } from "@/lib/auth/page-access";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime, formatMoney } from "@/lib/format";
import {
  EventAnalyticsAccessError,
  getOrganisationEventAnalytics,
  getOrganisationEventRevenueSeries
} from "@/lib/events/event-analytics";

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
  const canEdit = hasOrganisationPermission(organisation.staffRole, "events:manage");
  const attendance = hasOrganisationPermission(organisation.staffRole, "tickets:check_in");
  let analytics: Awaited<ReturnType<typeof getOrganisationEventAnalytics>>;
  let revenueSeries: Awaited<ReturnType<typeof getOrganisationEventRevenueSeries>>;

  try {
    [analytics, revenueSeries] = await Promise.all([
      getOrganisationEventAnalytics(organisation.id, eventId),
      financial ? getOrganisationEventRevenueSeries(organisation.id, eventId) : Promise.resolve([])
    ]);
  } catch (error) {
    if (error instanceof EventAnalyticsAccessError) {
      notFound();
    }

    throw error;
  }

  const maxDailyRevenue = Math.max(
    ...revenueSeries.map((bucket) => bucket.revenue),
    1
  );

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <section className="rounded-card border border-line bg-surface p-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-3xl space-y-3">
              <StatusBadge status={analytics.event.status} />
              <h2 className="text-3xl font-semibold text-ink">
                {analytics.event.title}
              </h2>
              <p className="max-w-3xl whitespace-pre-wrap text-sm leading-6 text-ink-soft">
                {analytics.event.description}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canEdit && <Link
                className="rounded-control border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-surface-subtle"
                href={`/dashboard/events/${analytics.event.id}/edit`}
              >
                Edit event
              </Link>}
              {attendance && <Link
                className="rounded-control border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-surface-subtle"
                href={`/dashboard/events/${analytics.event.id}/tickets`}
              >
                View tickets
              </Link>}
              {financial && <Link
                className="rounded-control bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
                href={`/dashboard/orders?eventId=${analytics.event.id}`}
              >
                View orders
              </Link>}
            </div>
          </div>

          <dl className="mt-6 grid gap-4 text-sm text-ink-soft sm:grid-cols-3">
            <div>
              <dt className="font-medium text-ink">Starts</dt>
              <dd className="mt-1">{formatDateTime(analytics.event.startTime, { dateStyle: "full" })}</dd>
            </div>
            <div>
              <dt className="font-medium text-ink">Ends</dt>
              <dd className="mt-1">{formatDateTime(analytics.event.endTime, { dateStyle: "full" })}</dd>
            </div>
            <div>
              <dt className="font-medium text-ink">Location</dt>
              <dd className="mt-1">{analytics.event.location}</dd>
            </div>
          </dl>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {financial && <div className="rounded-card border border-line bg-surface p-5">
            <p className="text-sm text-ink-muted">Revenue</p>
            <p className="mt-2 text-2xl font-semibold text-ink">
              {formatMoney(analytics.totals.revenue ?? 0)}
            </p>
          </div>}
          <div className="rounded-card border border-line bg-surface p-5">
            <p className="text-sm text-ink-muted">Sold</p>
            <p className="mt-2 text-2xl font-semibold text-ink">
              {analytics.totals.sold}
            </p>
          </div>
          <div className="rounded-card border border-line bg-surface p-5">
            <p className="text-sm text-ink-muted">Remaining</p>
            <p className="mt-2 text-2xl font-semibold text-ink">
              {analytics.totals.remaining}
            </p>
          </div>
        </section>

        {financial && <section className="rounded-card border border-line bg-surface p-6">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-ink">
              Revenue (UTC)
            </h3>
            <p className="mt-1 text-sm text-ink-muted">
              Paid order revenue grouped by UTC day.
            </p>
          </div>

          {revenueSeries.length === 0 ? (
            <p className="rounded-card border border-line bg-surface-subtle px-4 py-5 text-sm text-ink-muted">
              No revenue yet.
            </p>
          ) : (
            <div className="grid min-h-56 grid-cols-[auto_1fr] gap-4">
              <div className="flex flex-col justify-between py-1 text-xs text-ink-muted">
                <span>{formatMoney(maxDailyRevenue)}</span>
                <span>{formatMoney(0)}</span>
              </div>
              <div className="grid h-56 items-end gap-3 border-b border-l border-line px-3 pb-6 sm:grid-flow-col sm:auto-cols-fr">
                {revenueSeries.map((bucket) => {
                  const height = Math.max(
                    8,
                    (bucket.revenue / maxDailyRevenue) * 176
                  );

                  return (
                    <div
                      className="grid h-full min-w-12 content-end gap-2"
                      key={bucket.date}
                    >
                      <div
                        className="rounded-t-md bg-brand"
                        style={{ height: `${height}px` }}
                        title={`${formatShortDate(bucket.date)}: ${formatMoney(
                          bucket.revenue
                        )}`}
                      />
                      <p className="text-center text-xs text-ink-muted">
                        {formatShortDate(bucket.date)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>}

        <section className="rounded-card border border-line bg-surface p-6">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-ink">
              Ticket performance
            </h3>
            {analytics.totals.sold === 0 ? (
              <p className="mt-1 text-sm text-ink-muted">No tickets sold yet.</p>
            ) : null}
          </div>

          {analytics.ticketTypes.length === 0 ? (
            <p className="text-sm text-ink-muted">No ticket types available.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-ink-muted">
                    <th className="py-3 pr-4 font-medium">Ticket</th>
                    <th className="py-3 pr-4 font-medium">Remaining</th>
                    <th className="py-3 pr-4 font-medium">Sold</th>
                    {financial && <th className="py-3 pr-4 font-medium">Revenue</th>}
                    {financial && <th className="py-3 font-medium">Revenue share</th>}
                  </tr>
                </thead>
                <tbody>
                  {analytics.ticketTypes.map((ticketType) => {
                    const revenueShare =
                      (analytics.totals.revenue ?? 0) > 0
                        ? ((ticketType.revenue ?? 0) / (analytics.totals.revenue ?? 1)) * 100
                        : 0;

                    return (
                      <tr
                        className="border-b border-line last:border-0"
                        key={ticketType.id}
                      >
                        <td className="py-3 pr-4 font-medium text-ink">
                          {ticketType.name}
                        </td>
                        <td className="py-3 pr-4 text-ink-soft">
                          {ticketType.remaining}
                        </td>
                        <td className="py-3 pr-4 text-ink-soft">
                          {ticketType.sold}
                        </td>
                        {financial && <><td className="py-3 pr-4 text-ink-soft">
                          {formatMoney(ticketType.revenue ?? 0)}
                        </td>
                        <td className="py-3 text-ink-soft">
                          <div className="flex min-w-36 items-center gap-3">
                            <div className="h-2 flex-1 rounded-full bg-surface-subtle">
                              <div
                                className="h-2 rounded-full bg-brand"
                                style={{ width: `${revenueShare}%` }}
                              />
                            </div>
                            <span className="w-12 text-right text-xs text-ink-muted">
                              {revenueShare.toFixed(0)}%
                            </span>
                          </div>
                        </td></>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
