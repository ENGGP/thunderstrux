import { redirectLegacyOrganisationPage } from "@/lib/auth/page-access";

export default async function LegacyDashboardPage({
  params
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  return redirectLegacyOrganisationPage(
    orgSlug,
    ["events:manage", "orders:read", "tickets:check_in", "stripe:manage", "staff:manage"],
    `/dashboard/${orgSlug}`,
    "/dashboard"
  );
}
