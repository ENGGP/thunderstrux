import { redirectLegacyOrganisationPage } from "@/lib/auth/page-access";

export default async function LegacySettingsPage({
  params
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  return redirectLegacyOrganisationPage(
    orgSlug,
    ["stripe:manage"],
    `/dashboard/${orgSlug}/settings`,
    "/dashboard/settings"
  );
}
