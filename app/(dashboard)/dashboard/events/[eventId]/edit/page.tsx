import { notFound } from "next/navigation";
import { CreateEventForm } from "@/components/events/create-event-form";
import { EventWorkspaceHeader } from "@/components/events/event-tabs";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { Notice } from "@/components/ui/notice";
import { requireManagementPage } from "@/lib/auth/page-access";
import {
  EventLifecycleNotFoundError,
  getDashboardEvent,
  getOrganisationEventForEditing
} from "@/lib/events/event-lifecycle";

type EventFormData = {
  id: string;
  organisationId: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  location: string;
  status: "draft" | "published";
  compensationRefundMode: "manual_review" | "automatic_full";
  ticketTypes: Array<{
    id: string;
    name: string;
    price: number;
    quantity: number;
    ordersCount: number;
    ticketsCount: number;
  }>;
};

export default async function EditEventPage({
  params
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const organisation = await requireManagementPage("events:manage", `/dashboard/events/${eventId}/edit`);

  let initialEvent: EventFormData;
  let event: Awaited<ReturnType<typeof getDashboardEvent>>;

  try {
    [initialEvent, event] = await Promise.all([
      getOrganisationEventForEditing(organisation.id, eventId),
      getDashboardEvent(organisation.id, eventId)
    ]);
  } catch (error) {
    if (error instanceof EventLifecycleNotFoundError) {
      notFound();
    }

    throw error;
  }

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <div className="mx-auto grid max-w-admin grid-cols-1 gap-6 px-4 py-8 sm:px-8">
        <EventWorkspaceHeader active="edit" event={event} staffRole={organisation.staffRole} />
        {event.status === "published" ? (
          <Notice>
            This event is published. Changes show on the public page as soon as
            you save. Buyers are not emailed about them.
          </Notice>
        ) : null}
        <CreateEventForm
          basePath="/dashboard"
          eventId={eventId}
          initialEvent={initialEvent}
          mode="edit"
          orgSlug={organisation.slug}
        />
      </div>
    </DashboardShell>
  );
}
