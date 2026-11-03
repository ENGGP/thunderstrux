import type { Metadata } from "next";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { StripeConnectSettings } from "@/components/settings/stripe-connect-settings";
import { requireManagementPage } from "@/lib/auth/page-access";
import { Notice } from "@/components/ui/notice";
import { formatDateTime } from "@/lib/format";
import { readSupportHolds, readTimeZone } from "@/lib/organisations/profile";

export const metadata: Metadata = { title: "Payments" };

export default async function SettingsPage() {
  const organisation = await requireManagementPage("stripe:manage", "/dashboard/settings");
  const [timeZone, holds] = await Promise.all([readTimeZone(organisation.id), readSupportHolds(organisation.id)]);
  const held = holds.restrictedAt || (holds.payoutsHeldAt && (!holds.payoutsHeldUntil || holds.payoutsHeldUntil > new Date()));

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader description="Paid sales go to your society's Stripe account. Free tickets and memberships work without it." title="Payments" />
      <div className="grid max-w-4xl gap-6">
        {held ? (
          <Notice title={holds.restrictedAt ? "Thunderstrux support restricted this society" : "Thunderstrux support is holding payouts"} tone="warning">
            {holds.restrictedAt
              ? "Payouts, Stripe changes and new sales are paused until support lifts it. The owners were emailed."
              : holds.payoutsHeldUntil ? `Payouts resume after ${formatDateTime(holds.payoutsHeldUntil, { timeZone })}. Sales carry on as usual.` : "Payouts wait until support releases them. Sales carry on as usual."}
          </Notice>
        ) : null}
        <StripeConnectSettings orgSlug={organisation.slug} timeZone={timeZone} />
      </div>
    </DashboardShell>
  );
}
