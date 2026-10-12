import { DashboardShell } from "@/components/layout/dashboard-shell";
import { StaffManagement } from "@/components/settings/staff-management";
import { requireManagementPage } from "@/lib/auth/page-access";
import { requireAuthenticatedUser } from "@/lib/auth/access";
import { listHandoverTargets, listOrganisationStaff, listPastStaffInvites } from "@/lib/staff/management";
import { StaffHandover } from "@/components/settings/staff-handover";

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
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <div>
          <h2 className="text-2xl font-semibold text-ink">Staff</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Named people who can manage this society. Staff access is separate
            from joining the society: joining never grants it.
          </p>
        </div>
        <StaffManagement
          canManageOwners={organisation.staffRole === "owner"}
          initialInvites={invites}
          initialStaff={staff}
          pastInvites={pastInvites}
          orgSlug={organisation.slug}
        />
        {organisation.staffRole === "owner" && <StaffHandover orgSlug={organisation.slug} orgName={organisation.name}
          targets={handoverTargets.map(item => ({ id: item.id, email: item.user.email }))} />}
      </div>
    </DashboardShell>
  );
}
