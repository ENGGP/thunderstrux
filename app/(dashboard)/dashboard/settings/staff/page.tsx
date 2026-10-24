import type { Metadata } from "next";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { StaffManagement } from "@/components/settings/staff-management";
import { requireManagementPage } from "@/lib/auth/page-access";
import { requireAuthenticatedUser } from "@/lib/auth/access";
import { listHandoverTargets, listOrganisationStaff, listPastStaffInvites } from "@/lib/staff/management";
import { StaffHandover } from "@/components/settings/staff-handover";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffSettingsPage() {
  const organisation = await requireManagementPage("staff:manage", "/dashboard/settings/staff");
  const actor = await requireAuthenticatedUser();
  const handoverTargets = organisation.staffRole === "owner" ? await listHandoverTargets(organisation.id, actor.id) : [];
  const [{ staff, invites }, pastInvites] = await Promise.all([
    listOrganisationStaff(organisation.id),
    listPastStaffInvites(organisation.id)
  ]);

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader
        description={`Who can manage ${organisation.name}, and what each person can do. Joining a society never grants staff access.`}
        title="Staff"
      />
      <StaffManagement
        canManageOwners={organisation.staffRole === "owner"}
        initialInvites={invites}
        initialStaff={staff}
        pastInvites={pastInvites}
        orgSlug={organisation.slug}
      />
      {organisation.staffRole === "owner" && <StaffHandover orgSlug={organisation.slug} orgName={organisation.name}
        targets={handoverTargets.map(item => ({ id: item.id, email: item.user.email }))} />}
    </DashboardShell>
  );
}
