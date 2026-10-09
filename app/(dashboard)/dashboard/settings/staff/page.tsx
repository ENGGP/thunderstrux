import { DashboardShell } from "@/components/layout/dashboard-shell";
import { StaffManagement } from "@/components/settings/staff-management";
import { requireManagementPage } from "@/lib/auth/page-access";
import { prisma } from "@/lib/db";
import { requireAuthenticatedUser } from "@/lib/auth/access";
import { mfaEnforcementMode } from "@/lib/security/staff-mfa";
import { StaffHandover } from "@/components/settings/staff-handover";

export default async function StaffSettingsPage() {
  const organisation = await requireManagementPage("staff:manage", "/dashboard/settings/staff");
  const actor = await requireAuthenticatedUser();
  const handoverTargets = organisation.staffRole === "owner" ? await prisma.organisationStaff.findMany({
    where: { organisationId: organisation.id, status: "active", userId: { not: actor.id }, user: {
      disabledAt: null, emailVerifiedAt: { not: null }, ...(mfaEnforcementMode() === "enforce" ? { mfa: { is: { enabledAt: { not: null } } } } : {})
    } }, take: 100, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, user: { select: { email: true } } }
  }) : [];

  const [staff, invites] = await Promise.all([
    prisma.organisationStaff.findMany({
      take: 100,
      where: { organisationId: organisation.id },
      orderBy: [{ status: "asc" }, { role: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        role: true,
        status: true,
        user: {
          select: {
            email: true,
            firstName: true,
            lastName: true
          }
        }
      }
    }),
    prisma.organisationStaffInvite.findMany({
      where: {
        organisationId: organisation.id,
        acceptedAt: null,
        revokedAt: null
      },
      take: 100,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true
      }
    })
  ]);

  return (
    <DashboardShell basePath="/dashboard" orgName={organisation.name} staffRole={organisation.staffRole}>
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <div>
          <h2 className="text-2xl font-semibold text-neutral-950">Staff</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Manage named staff access for this organisation.
          </p>
        </div>
        <StaffManagement
          canManageOwners={organisation.staffRole === "owner"}
          initialInvites={invites}
          initialStaff={staff}
          orgSlug={organisation.slug}
        />
        {organisation.staffRole === "owner" && <StaffHandover orgSlug={organisation.slug} orgName={organisation.name}
          targets={handoverTargets.map(item => ({ id: item.id, email: item.user.email }))} />}
      </div>
    </DashboardShell>
  );
}
