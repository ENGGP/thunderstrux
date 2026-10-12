import { redirectLegacyOrganisationPage } from "@/lib/auth/page-access";

export default async function LegacyEditEventPage({
  params
}: {
  params: Promise<{ eventId: string; orgSlug: string }>;
}) {
  const { eventId, orgSlug } = await params;

  return redirectLegacyOrganisationPage(
    orgSlug,
    ["events:manage"],
    `/dashboard/${orgSlug}/events/${eventId}/edit`,
    `/dashboard/events/${eventId}/edit`
  );
}
