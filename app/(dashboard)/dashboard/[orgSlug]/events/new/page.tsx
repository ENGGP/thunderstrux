import { CreateEventForm } from "@/components/events/create-event-form";

export default async function NewEventPage({
  params
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold text-neutral-950">Create Event</h1>
      <CreateEventForm orgSlug={orgSlug} />
    </div>
  );
}
