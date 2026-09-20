import { notFound } from "next/navigation";
import { CreateEventForm } from "@/components/events/create-event-form";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import {
  requireCurrentOrganisationAccount,
  requireOrganisationEventManagementAccess
} from "@/lib/auth/access";
import {
  EventLifecycleNotFoundError,
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
  const organisation = await requireCurrentOrganisationAccount();
  await requireOrganisationEventManagementAccess(organisation.id);

  let initialEvent: EventFormData;

  try {
    initialEvent = await getOrganisationEventForEditing(
      organisation.id,
      eventId
    );
  } catch (error) {
    if (error instanceof EventLifecycleNotFoundError) {
      notFound();
    }

    throw error;
  }

  return (
    <DashboardShell basePath="/dashboard" orgName={organisation.name}>
      <div className="mx-auto max-w-5xl px-6 py-10">
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
