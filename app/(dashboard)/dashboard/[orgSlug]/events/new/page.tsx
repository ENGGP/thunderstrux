import { redirectLegacyOrganisationPage } from "@/lib/auth/page-access";

export default async function LegacyNewEventPage({
  params
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  return redirectLegacyOrganisationPage(
    orgSlug,
    ["events:manage"],
    `/dashboard/${orgSlug}/events/new`,
    "/dashboard/events/new"
  );
}
