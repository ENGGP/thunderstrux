import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import {
  OrganisationAccessError,
  requireCurrentOrganisationAccount
} from "@/lib/auth/access";
import {
  EventAnalyticsAccessError,
  getOrganisationEventAnalytics
} from "@/lib/events/event-analytics";

type OrganiserEventPageProps = {
  params: Promise<{
    eventId: string;
  }>;
};

function formatCurrency(amountInCents: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "AUD"
  }).format(amountInCents / 100);
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "short"
  }).format(value);
}

function statusBadgeClassName(status: "draft" | "published") {
  return status === "published"
    ? "rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 ring-1 ring-green-200"
    : "rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200";
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

  try {
    analytics = await getOrganisationEventAnalytics(organisation.id, eventId);
  } catch (error) {
    if (error instanceof EventAnalyticsAccessError) {
      notFound();
    }

    throw error;
  }

  return (
    <DashboardShell basePath="/dashboard" orgName={organisation.name}>
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
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
              Ticket analytics
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
                    <th className="py-3 font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.ticketTypes.map((ticketType) => (
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
                      <td className="py-3 text-neutral-700">
                        {formatCurrency(ticketType.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
