import type { Metadata } from "next";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { SocietyProfile } from "@/components/settings/society-profile";
import { requireManagementPage } from "@/lib/auth/page-access";
import { readChargeReadiness, readProfile } from "@/lib/organisations/profile";
import { hasOrganisationPermission } from "@/lib/permissions";
import { listOrganisationStaff } from "@/lib/staff/management";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Society settings" };

export default async function SocietyProfilePage() {
  const organisation = await requireManagementPage(
    "organisation:settings",
    "/dashboard/settings/profile",
  );
  const profile = await readProfile(organisation.id);
  if (!profile) notFound();
  const canManageStaff = hasOrganisationPermission(
    organisation.staffRole,
    "staff:manage",
  );
  const canManageStripe = hasOrganisationPermission(
    organisation.staffRole,
    "stripe:manage",
  );
  // Each fact is read only for callers allowed to see it elsewhere.
  const [team, chargesReady] = await Promise.all([
    canManageStaff ? listOrganisationStaff(organisation.id) : null,
    canManageStripe ? readChargeReadiness(organisation.id) : null,
  ]);
  // Computed here so server and browser render the same list.
  const zones = Intl.supportedValuesOf("timeZone");
  const timeZones = zones.includes(profile.timeZone)
    ? zones
    : [profile.timeZone, ...zones];

  return (
    <DashboardShell
      contexts={organisation.contexts}
      orgName={organisation.name}
      staffRole={organisation.staffRole}
    >
      <div className="max-w-3xl">
        <SocietyProfile
          initialProfile={{
            ...profile,
            onboardingCompletedAt:
              profile.onboardingCompletedAt?.toISOString() ?? null,
          }}
          checklist={{
            activeStaff: team
              ? team.staff.filter((row) => row.status === "active").length
              : null,
            pendingInvites: team ? team.invites.length : null,
            chargesReady,
          }}
          timeZones={timeZones}
        />
      </div>
    </DashboardShell>
  );
}
