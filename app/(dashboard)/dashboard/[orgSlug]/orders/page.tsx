import { redirectLegacyOrganisationPage } from "@/lib/auth/page-access";

export default async function LegacyOrdersPage({
  params
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  return redirectLegacyOrganisationPage(
    orgSlug,
    ["orders:read"],
    `/dashboard/${orgSlug}/orders`,
    "/dashboard/orders"
  );
}
