import type { Metadata } from "next";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { StripeConnectSettings } from "@/components/settings/stripe-connect-settings";
import { requireManagementPage } from "@/lib/auth/page-access";

export const metadata: Metadata = { title: "Payments" };

export default async function SettingsPage() {
  const organisation = await requireManagementPage("stripe:manage", "/dashboard/settings");

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader description="Paid sales go to your society's Stripe account. Free tickets and memberships work without it." title="Payments" />
      <div className="grid max-w-4xl gap-6">
        <StripeConnectSettings orgSlug={organisation.slug} />
      </div>
    </DashboardShell>
  );
}
