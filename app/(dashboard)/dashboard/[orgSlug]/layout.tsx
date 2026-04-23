import { DashboardShell } from "@/components/layout/dashboard-shell";
import { notFound } from "next/navigation";
import {
  OrganisationAccessError,
  requireOrganisationMembershipBySlug
} from "@/lib/auth/access";

export default async function OrganisationDashboardLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  let organisation: Awaited<ReturnType<typeof requireOrganisationMembershipBySlug>>;

  try {
    organisation = await requireOrganisationMembershipBySlug(orgSlug);
  } catch (error) {
    if (error instanceof OrganisationAccessError) {
      notFound();
    }

    throw error;
  }

  return (
    <DashboardShell orgName={organisation.name} orgSlug={orgSlug}>
      {children}
    </DashboardShell>
  );
}
