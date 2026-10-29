import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EventWorkspaceHeader } from "@/components/events/event-tabs";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { DownloadCsv } from "@/components/orders/download-csv";
import { CheckInConsole } from "@/components/tickets/check-in-console";
import { Pager } from "@/components/ui/pager";
import { requireManagementPage } from "@/lib/auth/page-access";
import { EventLifecycleNotFoundError, getDashboardEvent } from "@/lib/events/event-lifecycle";
import { hasOrganisationPermission } from "@/lib/permissions";
import { PaginationError, parsePaginationOptions } from "@/lib/pagination/cursor";
import { OrganisationEventTicketsAccessError, getOrganisationEventTickets } from "@/lib/tickets/check-in";

export const metadata: Metadata = { title: "Attendees" };

// The check-in console (T19b): search-first, with a page of tickets that admit below.
export default async function OrganiserEventTicketsPage({
  params,
  searchParams
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { eventId } = await params;
  const raw = await searchParams;
  let pagination: ReturnType<typeof parsePaginationOptions>;
  try {
    pagination = parsePaginationOptions(new URLSearchParams(Object.entries(raw).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : []))));
  } catch (error) {
    if (error instanceof PaginationError) redirect(`/dashboard/events/${eventId}/tickets`);
    throw error;
  }

  const organisation = await requireManagementPage("tickets:check_in", `/dashboard/events/${eventId}/tickets`);
  let payload: Awaited<ReturnType<typeof getOrganisationEventTickets>>;
  let event: Awaited<ReturnType<typeof getDashboardEvent>>;
  // The ticket read decides the 404 (check-in staff see published events only).
  try {
    payload = await getOrganisationEventTickets(organisation.id, eventId, pagination);
    event = await getDashboardEvent(organisation.id, eventId);
  } catch (error) {
    if (error instanceof OrganisationEventTicketsAccessError || error instanceof EventLifecycleNotFoundError) notFound();
    throw error;
  }

  const pageHref = (cursor: string, direction: "next" | "prev") =>
    `/dashboard/events/${eventId}/tickets?${new URLSearchParams({ limit: String(payload.pageInfo.limit), cursor, direction })}`;

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <EventWorkspaceHeader active="attendees" event={event} staffRole={organisation.staffRole} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-lg font-semibold text-ink" role="status">
          {payload.counts.checkedIn} of {payload.counts.total} checked in
        </p>
        {/* The list holds buyer emails, so it's for those who can read orders: owners and admins (UI-018). */}
        {hasOrganisationPermission(organisation.staffRole, "orders:read") ? <DownloadCsv href={`/api/events/${eventId}/tickets/export`} label="Download attendee list" /> : null}
      </div>
      <CheckInConsole
        eventId={eventId}
        footer={
          <Pager
            label="Ticket pagination"
            next={payload.pageInfo.nextCursor && pageHref(payload.pageInfo.nextCursor, "next")}
            previous={payload.pageInfo.previousCursor && pageHref(payload.pageInfo.previousCursor, "prev")}
          />
        }
        initialTickets={payload.tickets}
        timeZone={event.timeZone}
      />
      <p className="text-sm text-ink-soft">Guests show with &ldquo;guest&rdquo; before their email. Each check-in or undo records who did it and when.</p>
    </DashboardShell>
  );
}
