import { EventsList } from "@/components/events/events-list";

export default async function EventsPage({
  params
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  return <EventsList orgSlug={orgSlug} />;
}
