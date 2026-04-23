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

  try {
    await requireOrganisationMembershipBySlug(orgSlug);
  } catch (error) {
    if (error instanceof OrganisationAccessError) {
      notFound();
    }

    throw error;
  }

  return <DashboardShell orgSlug={orgSlug}>{children}</DashboardShell>;
}
