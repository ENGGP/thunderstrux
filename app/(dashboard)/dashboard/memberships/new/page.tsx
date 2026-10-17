import type { Metadata } from "next";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { PlanForm } from "@/components/memberships/plan-form";
import { requireManagementPage } from "@/lib/auth/page-access";
import { readTimeZone } from "@/lib/organisations/profile";
import { toZonedInput } from "@/lib/zoned-time";

export const metadata: Metadata = { title: "New membership plan" };

export default async function NewMembershipPlanPage() {
  const organisation = await requireManagementPage("memberships:manage", "/dashboard/memberships/new");
  const timeZone = await readTimeZone(organisation.id);
  const year = Number(toZonedInput(new Date(), timeZone).slice(0, 4));

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader breadcrumbs={[{ label: "Memberships", href: "/dashboard/memberships" }]} title="New membership plan" />
      <div className="grid max-w-3xl gap-4">
        <PlanForm orgSlug={organisation.slug} timeZone={timeZone} years={[year, year + 1, year + 2].map(String)} />
        <p className="text-sm text-ink-soft">Save the draft first. The publish check and a preview of the offer appear next.</p>
      </div>
    </DashboardShell>
  );
}
