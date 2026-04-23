import { notFound } from "next/navigation";
import { CreateEventForm } from "@/components/events/create-event-form";
import {
  OrganisationAccessError,
  requireOrganisationMembershipBySlug
} from "@/lib/auth/access";
import { prisma } from "@/lib/db";

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
  }>;
};

export default async function EditEventPage({
  params
}: {
  params: Promise<{ eventId: string; orgSlug: string }>;
}) {
  const { eventId, orgSlug } = await params;
  let organisation: { id: string };

  try {
    organisation = await requireOrganisationMembershipBySlug(orgSlug);
  } catch (error) {
    if (error instanceof OrganisationAccessError) {
      notFound();
    }

    throw error;
  }

  const event = await prisma.event.findFirst({
    where: {
      id: eventId,
      organisationId: organisation.id
    },
    select: {
      id: true,
      organisationId: true,
      title: true,
      description: true,
      startTime: true,
      endTime: true,
      location: true,
      status: true,
      ticketTypes: {
        select: {
          id: true,
          name: true,
          price: true,
          quantity: true
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!event) {
    notFound();
  }

  const initialEvent: EventFormData = {
    ...event,
    startTime: event.startTime.toISOString(),
    endTime: event.endTime.toISOString()
  };

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold text-neutral-950">Edit Event</h1>
      <CreateEventForm
        eventId={eventId}
        initialEvent={initialEvent}
        mode="edit"
        orgSlug={orgSlug}
      />
    </div>
  );
}
