import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EventWorkspaceHeader } from "@/components/events/event-tabs";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TicketCheckInButton } from "@/components/tickets/ticket-check-in-button";
import { requireManagementPage } from "@/lib/auth/page-access";
import { StatusBadge } from "@/components/ui/status-badge";
import { EventLifecycleNotFoundError, getDashboardEvent } from "@/lib/events/event-lifecycle";
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

// Enough of the id to match a printed or emailed ticket; the full id is in the title.
function shortTicketId(id: string) {
  return id.slice(-6);
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
  let event: Awaited<ReturnType<typeof getDashboardEvent>>;

  // The ticket read decides the 404 (check-in staff see published events only).
  try {
    payload = await getOrganisationEventTickets(
      organisation.id,
      eventId,
      pagination
    );
    event = await getDashboardEvent(organisation.id, eventId);
  } catch (error) {
    if (
      error instanceof OrganisationEventTicketsAccessError ||
      error instanceof EventLifecycleNotFoundError
    ) {
      notFound();
    }

    throw error;
  }

  const tiles = [
    { label: "Checked in", value: payload.counts.checkedIn },
    { label: "Not yet", value: payload.counts.unused },
    { label: "Tickets", value: payload.counts.total }
  ];
  const pageLink = buttonClasses({ variant: "secondary", size: "sm" });

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <EventWorkspaceHeader active="attendees" event={event} staffRole={organisation.staffRole} />

      <div className="grid grid-cols-3 gap-3 sm:gap-6">
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <p className="text-[28px] font-semibold leading-tight tabular-nums text-ink">{tile.value}</p>
            <p className="mt-1 text-sm font-semibold text-ink-soft">{tile.label}</p>
          </Card>
        ))}
      </div>

      {payload.counts.total === 0 ? (
        <div className="rounded-card border border-line bg-surface p-6 text-ink-soft">
          No issued tickets yet.
        </div>
      ) : payload.tickets.length === 0 ? (
        <div className="rounded-card border border-line bg-surface p-6 text-ink-soft">
          <p>No tickets found on this page.</p>
          <Link
            className="mt-2 inline-flex font-semibold text-brand underline underline-offset-4"
            href={`/dashboard/events/${payload.event.id}/tickets`}
          >
            Back to first page
          </Link>
        </div>
      ) : (
        <>
          <ul className="grid gap-3 md:hidden">
            {payload.tickets.map((ticket) => (
              <li className="grid gap-3 rounded-card border border-line bg-surface p-4" key={ticket.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink [overflow-wrap:anywhere]">{ticket.buyerName ?? ticket.buyerEmail ?? "Unknown buyer"}</p>
                    {ticket.buyerName && ticket.buyerEmail ? (
                      <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{ticket.buyerEmail}</p>
                    ) : null}
                    <p className="text-sm text-ink-soft">
                      {ticket.ticketTypeName} · ticket {shortTicketId(ticket.id)}
                    </p>
                  </div>
                  <StatusBadge label={ticket.checkedInAt ? undefined : "Not checked in"} status={ticket.status} />
                </div>
                <TicketCheckInButton
                  buyer={buyerLabel(ticket.buyerEmail, ticket.buyerName)}
                  initialCheckedInAt={ticket.checkedInAt ? ticket.checkedInAt.toISOString() : null}
                  size="lg"
                  ticketId={ticket.id}
                />
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
            <table className="w-full min-w-[720px] border-collapse text-left text-[15px]">
              <thead>
                <tr className="text-[13px] text-ink-soft">
                  <th className="px-5 py-3.5 font-semibold" scope="col">Attendee</th>
                  <th className="px-3 py-3.5 font-semibold" scope="col">Ticket</th>
                  <th className="px-3 py-3.5 font-semibold" scope="col">Status</th>
                  <th className="px-3 py-3.5 font-semibold" scope="col">Issued</th>
                  <th className="px-5 py-3.5 font-semibold" scope="col">Check-in</th>
                </tr>
              </thead>
              <tbody>
                {payload.tickets.map((ticket) => (
                  <tr className="border-t border-line align-top" key={ticket.id}>
                    <td className="px-5 py-3.5 text-ink [overflow-wrap:anywhere]">
                      {buyerLabel(ticket.buyerEmail, ticket.buyerName)}
                    </td>
                    <td className="px-3 py-3.5">
                      <p className="text-ink">{ticket.ticketTypeName}</p>
                      <p className="font-mono text-xs text-ink-soft" title={ticket.id}>{shortTicketId(ticket.id)}</p>
                    </td>
                    <td className="px-3 py-3.5">
                      <StatusBadge label={ticket.checkedInAt ? undefined : "Not checked in"} status={ticket.status} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-ink-soft">{formatDateTime(ticket.createdAt)}</td>
                    <td className="px-5 py-3.5">
                      <TicketCheckInButton
                        buyer={buyerLabel(ticket.buyerEmail, ticket.buyerName)}
                        initialCheckedInAt={ticket.checkedInAt ? ticket.checkedInAt.toISOString() : null}
                        ticketId={ticket.id}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-ink-soft">
              Showing {payload.tickets.length} of {payload.counts.total} tickets
            </p>
            <nav aria-label="Ticket pagination" className="flex gap-2">
              {payload.pageInfo.hasPreviousPage && payload.pageInfo.previousCursor ? (
                <Link
                  className={pageLink}
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
                  className={pageLink}
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
            </nav>
          </div>
        </>
      )}
    </DashboardShell>
  );
}
