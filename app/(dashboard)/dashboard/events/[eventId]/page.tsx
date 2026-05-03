import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import {
  OrganisationAccessError,
  requireCurrentOrganisationAccount
} from "@/lib/auth/access";
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

function formatCurrency(amountInCents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD"
  }).format(amountInCents / 100);
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Australia/Brisbane"
  }).format(value);
}

function statusBadgeClassName(status: "draft" | "published") {
  return status === "published"
    ? "rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 ring-1 ring-green-200"
    : "rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200";
}

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
  let organisation: Awaited<ReturnType<typeof requireCurrentOrganisationAccount>>;

  try {
    organisation = await requireCurrentOrganisationAccount();
  } catch (error) {
    if (error instanceof OrganisationAccessError) {
      redirect("/");
    }

    throw error;
  }

  let analytics: Awaited<ReturnType<typeof getOrganisationEventAnalytics>>;
  let revenueSeries: Awaited<ReturnType<typeof getOrganisationEventRevenueSeries>>;

  try {
    [analytics, revenueSeries] = await Promise.all([
      getOrganisationEventAnalytics(organisation.id, eventId),
      getOrganisationEventRevenueSeries(organisation.id, eventId)
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
    <DashboardShell basePath="/dashboard" orgName={organisation.name}>
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-3xl space-y-3">
              <span className={statusBadgeClassName(analytics.event.status)}>
                {analytics.event.status === "published" ? "Published" : "Draft"}
              </span>
              <h2 className="text-3xl font-semibold text-neutral-950">
                {analytics.event.title}
              </h2>
              <p className="max-w-3xl whitespace-pre-wrap text-sm leading-6 text-neutral-700">
                {analytics.event.description}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
                href={`/dashboard/events/${analytics.event.id}/edit`}
              >
                Edit event
              </Link>
              <Link
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
                href={`/dashboard/events/${analytics.event.id}/tickets`}
              >
                View tickets
              </Link>
              <Link
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
                href={`/dashboard/orders?eventId=${analytics.event.id}`}
              >
                View orders
              </Link>
            </div>
          </div>

          <dl className="mt-6 grid gap-4 text-sm text-neutral-700 sm:grid-cols-3">
            <div>
              <dt className="font-medium text-neutral-950">Starts</dt>
              <dd className="mt-1">{formatDateTime(analytics.event.startTime)}</dd>
            </div>
            <div>
              <dt className="font-medium text-neutral-950">Ends</dt>
              <dd className="mt-1">{formatDateTime(analytics.event.endTime)}</dd>
            </div>
            <div>
              <dt className="font-medium text-neutral-950">Location</dt>
              <dd className="mt-1">{analytics.event.location}</dd>
            </div>
          </dl>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-neutral-500">Revenue</p>
            <p className="mt-2 text-2xl font-semibold text-neutral-950">
              {formatCurrency(analytics.totals.revenue)}
            </p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-neutral-500">Sold</p>
            <p className="mt-2 text-2xl font-semibold text-neutral-950">
              {analytics.totals.sold}
            </p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-neutral-500">Remaining</p>
            <p className="mt-2 text-2xl font-semibold text-neutral-950">
              {analytics.totals.remaining}
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-neutral-950">
              Revenue (UTC)
            </h3>
            <p className="mt-1 text-sm text-neutral-500">
              Paid order revenue grouped by UTC day.
            </p>
          </div>

          {revenueSeries.length === 0 ? (
            <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-5 text-sm text-neutral-600">
              No revenue yet.
            </p>
          ) : (
            <div className="grid min-h-56 grid-cols-[auto_1fr] gap-4">
              <div className="flex flex-col justify-between py-1 text-xs text-neutral-500">
                <span>{formatCurrency(maxDailyRevenue)}</span>
                <span>{formatCurrency(0)}</span>
              </div>
              <div className="grid h-56 items-end gap-3 border-b border-l border-neutral-200 px-3 pb-6 sm:grid-flow-col sm:auto-cols-fr">
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
                        className="rounded-t-md bg-neutral-900"
                        style={{ height: `${height}px` }}
                        title={`${formatShortDate(bucket.date)}: ${formatCurrency(
                          bucket.revenue
                        )}`}
                      />
                      <p className="text-center text-xs text-neutral-500">
                        {formatShortDate(bucket.date)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-neutral-950">
              Ticket performance
            </h3>
            {analytics.totals.sold === 0 ? (
              <p className="mt-1 text-sm text-neutral-500">No tickets sold yet.</p>
            ) : null}
          </div>

          {analytics.ticketTypes.length === 0 ? (
            <p className="text-sm text-neutral-600">No ticket types available.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-neutral-500">
                    <th className="py-3 pr-4 font-medium">Ticket</th>
                    <th className="py-3 pr-4 font-medium">Remaining</th>
                    <th className="py-3 pr-4 font-medium">Sold</th>
                    <th className="py-3 pr-4 font-medium">Revenue</th>
                    <th className="py-3 font-medium">Revenue share</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.ticketTypes.map((ticketType) => {
                    const revenueShare =
                      analytics.totals.revenue > 0
                        ? (ticketType.revenue / analytics.totals.revenue) * 100
                        : 0;

                    return (
                      <tr
                        className="border-b border-neutral-100 last:border-0"
                        key={ticketType.id}
                      >
                        <td className="py-3 pr-4 font-medium text-neutral-950">
                          {ticketType.name}
                        </td>
                        <td className="py-3 pr-4 text-neutral-700">
                          {ticketType.remaining}
                        </td>
                        <td className="py-3 pr-4 text-neutral-700">
                          {ticketType.sold}
                        </td>
                        <td className="py-3 pr-4 text-neutral-700">
                          {formatCurrency(ticketType.revenue)}
                        </td>
                        <td className="py-3 text-neutral-700">
                          <div className="flex min-w-36 items-center gap-3">
                            <div className="h-2 flex-1 rounded-full bg-neutral-100">
                              <div
                                className="h-2 rounded-full bg-neutral-900"
                                style={{ width: `${revenueShare}%` }}
                              />
                            </div>
                            <span className="w-12 text-right text-xs text-neutral-600">
                              {revenueShare.toFixed(0)}%
                            </span>
                          </div>
                        </td>
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
