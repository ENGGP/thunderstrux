import Link from "next/link";
import { EventsList } from "@/components/events/events-list";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { requireManagementPage } from "@/lib/auth/page-access";
import { listOrganisationEventLinks } from "@/lib/events/event-lifecycle";

export default async function EventsPage() {
  const organisation = await requireManagementPage("events:read", "/dashboard/events");

  const canEdit = ["owner", "admin", "event_manager"].includes(organisation.staffRole);
  const events = canEdit ? [] : await listOrganisationEventLinks(organisation.id, organisation.staffRole === "check_in_staff");
  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <div className="mx-auto max-w-5xl px-6 py-10">
        {canEdit ? <EventsList basePath="/dashboard" orgSlug={organisation.slug} /> :
          <><h2 className="text-xl font-semibold">Events</h2><ul>{events.map(event => <li key={event.id} className="my-4">
            <Link className="underline" href={organisation.staffRole === "check_in_staff" ? `/dashboard/events/${event.id}/tickets` : `/dashboard/events/${event.id}`}>
              {event.title}</Link><p>{event.startTime.toLocaleString("en-AU", { timeZone: "Australia/Brisbane" })} - {event.location}</p></li>)}</ul></>}
      </div>
    </DashboardShell>
  );
}
