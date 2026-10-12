import { hasOrganisationPermission } from "@/lib/permissions";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { TicketCheckInButton } from "@/components/tickets/ticket-check-in-button";
import { requireManagementPage } from "@/lib/auth/page-access";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/format";
import {
  OrganisationEventTicketsAccessError,
  TicketPaginationError,
  getOrganisationEventTickets,
  parseTicketPaginationOptions
} from "@/lib/tickets/check-in";

type OrganiserEventTicketsPageProps = {
  params: Promise<{
    eventId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function buyerLabel(email: string | null, name: string | null) {
  if (email && name) {
    return `${name} (${email})`;
  }

  return name ?? email ?? "Unknown buyer";
}

function firstSearchParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function toUrlSearchParams(
  searchParams: Record<string, string | string[] | undefined>
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    const firstValue = firstSearchParamValue(value);

    if (firstValue) {
      params.set(key, firstValue);
    }
  }

  return params;
}

function paginationHref({
  eventId,
  limit,
  cursor,
  direction
}: {
  eventId: string;
  limit: number;
  cursor: string;
  direction: "next" | "prev";
}) {
  const params = new URLSearchParams({
    limit: String(limit),
    cursor,
    direction
  });

  return `/dashboard/events/${eventId}/tickets?${params.toString()}`;
}

export default async function OrganiserEventTicketsPage({
  params,
  searchParams
}: OrganiserEventTicketsPageProps) {
  const { eventId } = await params;
  const rawSearchParams = await searchParams;
  let pagination: ReturnType<typeof parseTicketPaginationOptions>;

  try {
    pagination = parseTicketPaginationOptions(toUrlSearchParams(rawSearchParams));
  } catch (error) {
    if (error instanceof TicketPaginationError) {
      redirect(`/dashboard/events/${eventId}/tickets`);
    }

    throw error;
  }

  const organisation = await requireManagementPage("tickets:check_in", `/dashboard/events/${eventId}/tickets`);

  let payload: Awaited<ReturnType<typeof getOrganisationEventTickets>>;

  try {
    payload = await getOrganisationEventTickets(
      organisation.id,
      eventId,
      pagination
    );
  } catch (error) {
    if (error instanceof OrganisationEventTicketsAccessError) {
      notFound();
    }

    throw error;
  }

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
        <section className="rounded-card border border-line bg-surface p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-ink-muted">Tickets</p>
              <h2 className="mt-2 text-3xl font-semibold text-ink">
                {payload.event.title}
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {hasOrganisationPermission(organisation.staffRole, "analytics:read") && <Link
                className="rounded-control border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-surface-subtle"
                href={`/dashboard/events/${payload.event.id}`}
              >
                Back to event
              </Link>}
              {hasOrganisationPermission(organisation.staffRole, "orders:read") && <Link
                className="rounded-control bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
                href={`/dashboard/orders?eventId=${payload.event.id}`}
              >
                View orders
              </Link>}
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-card border border-line bg-surface p-5">
            <p className="text-sm text-ink-muted">Total tickets</p>
            <p className="mt-2 text-2xl font-semibold text-ink">
              {payload.counts.total}
            </p>
          </div>
          <div className="rounded-card border border-line bg-surface p-5">
            <p className="text-sm text-ink-muted">Unused</p>
            <p className="mt-2 text-2xl font-semibold text-ink">
              {payload.counts.unused}
            </p>
          </div>
          <div className="rounded-card border border-line bg-surface p-5">
            <p className="text-sm text-ink-muted">Checked in</p>
            <p className="mt-2 text-2xl font-semibold text-ink">
              {payload.counts.checkedIn}
            </p>
          </div>
        </section>

        <section className="rounded-card border border-line bg-surface p-6">
          {payload.counts.total === 0 ? (
            <p className="rounded-card border border-line bg-surface-subtle px-4 py-5 text-sm text-ink-muted">
              No issued tickets yet.
            </p>
          ) : payload.tickets.length === 0 ? (
            <div className="rounded-card border border-line bg-surface-subtle px-4 py-5 text-sm text-ink-muted">
              <p>No tickets found on this page.</p>
              <Link
                className="mt-3 inline-flex text-sm font-medium text-ink hover:text-ink-soft"
                href={`/dashboard/events/${payload.event.id}/tickets`}
              >
                Back to first page
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-ink-muted">
                      <th className="py-3 pr-4 font-medium">Ticket ID</th>
                      <th className="py-3 pr-4 font-medium">Buyer</th>
                      <th className="py-3 pr-4 font-medium">Ticket type</th>
                      <th className="py-3 pr-4 font-medium">Status</th>
                      <th className="py-3 pr-4 font-medium">Created</th>
                      <th className="py-3 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.tickets.map((ticket) => (
                      <tr
                        className="border-b border-line align-top last:border-0"
                        key={ticket.id}
                      >
                        <td className="max-w-56 break-all py-3 pr-4 font-mono text-xs text-ink-soft">
                          {ticket.id}
                        </td>
                        <td className="py-3 pr-4 text-ink-soft">
                          {buyerLabel(ticket.buyerEmail, ticket.buyerName)}
                        </td>
                        <td className="py-3 pr-4 text-ink-soft">
                          {ticket.ticketTypeName}
                        </td>
                        <td className="py-3 pr-4">
                          <StatusBadge status={ticket.status} />
                        </td>
                        <td className="py-3 pr-4 text-ink-soft">
                          {formatDateTime(ticket.createdAt)}
                        </td>
                        <td className="py-3">
                          <TicketCheckInButton
                            initialCheckedInAt={
                              ticket.checkedInAt
                                ? ticket.checkedInAt.toISOString()
                                : null
                            }
                            ticketId={ticket.id}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm">
                <p className="text-ink-muted">
                  Showing {payload.tickets.length} of {payload.counts.total} tickets
                </p>
                <div className="flex gap-2">
                  {payload.pageInfo.hasPreviousPage &&
                  payload.pageInfo.previousCursor ? (
                    <Link
                      className="rounded-control border border-line-strong px-4 py-2 font-medium text-ink hover:bg-surface-subtle"
                      href={paginationHref({
                        eventId: payload.event.id,
                        limit: payload.pageInfo.limit,
                        cursor: payload.pageInfo.previousCursor,
                        direction: "prev"
                      })}
                    >
                      Previous
                    </Link>
                  ) : null}
                  {payload.pageInfo.hasNextPage && payload.pageInfo.nextCursor ? (
                    <Link
                      className="rounded-control border border-line-strong px-4 py-2 font-medium text-ink hover:bg-surface-subtle"
                      href={paginationHref({
                        eventId: payload.event.id,
                        limit: payload.pageInfo.limit,
                        cursor: payload.pageInfo.nextCursor,
                        direction: "next"
                      })}
                    >
                      Next
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
