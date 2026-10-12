import { DashboardShell } from "@/components/layout/dashboard-shell";
import { SocietyProfile } from "@/components/settings/society-profile";
import { requireManagementPage } from "@/lib/auth/page-access";
import { readProfile } from "@/lib/organisations/profile";
import { hasOrganisationPermission } from "@/lib/permissions";
import { notFound } from "next/navigation";
export default async function SocietyProfilePage() {
  const organisation = await requireManagementPage(
    "organisation:settings",
    "/dashboard/settings/profile",
  );
  const profile = await readProfile(organisation.id);
  if (!profile) notFound();
  return (
    <DashboardShell
      contexts={organisation.contexts}
      orgName={organisation.name}
      staffRole={organisation.staffRole}
    >
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <SocietyProfile
          initialProfile={{
            ...profile,
            onboardingCompletedAt:
              profile.onboardingCompletedAt?.toISOString() ?? null,
          }}
          canManageStaff={hasOrganisationPermission(
            organisation.staffRole,
            "staff:manage",
          )}
          canManageStripe={hasOrganisationPermission(
            organisation.staffRole,
            "stripe:manage",
          )}
        />
      </div>
    </DashboardShell>
  );
}
