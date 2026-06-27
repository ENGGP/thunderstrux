import { DashboardShell } from "@/components/layout/dashboard-shell";
import { StaffManagement } from "@/components/settings/staff-management";
import {
  requireCurrentOrganisationAccount,
  requireOrganisationPermission
} from "@/lib/auth/access";
import { prisma } from "@/lib/db";

export default async function StaffSettingsPage() {
  const organisation = await requireCurrentOrganisationAccount();
  await requireOrganisationPermission(organisation.id, "staff:manage");

  const [staff, invites] = await Promise.all([
    prisma.organisationStaff.findMany({
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
    <DashboardShell basePath="/dashboard" orgName={organisation.name}>
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <div>
          <h2 className="text-2xl font-semibold text-neutral-950">Staff</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Manage named staff access for this organisation.
          </p>
        </div>
        <StaffManagement
          initialInvites={invites}
          initialStaff={staff}
          orgSlug={organisation.slug}
        />
      </div>
    </DashboardShell>
  );
}
