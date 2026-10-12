import { redirectLegacyOrganisationPage } from "@/lib/auth/page-access";

export default async function LegacyEventsPage({
  params
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  return redirectLegacyOrganisationPage(
    orgSlug,
    ["events:manage"],
    `/dashboard/${orgSlug}/events`,
    "/dashboard/events"
  );
}
