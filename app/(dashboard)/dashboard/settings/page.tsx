import { DashboardShell } from "@/components/layout/dashboard-shell";
import { StripeConnectSettings } from "@/components/settings/stripe-connect-settings";
import { requireCurrentOrganisationAccount } from "@/lib/auth/access";

export default async function SettingsPage() {
  const organisation = await requireCurrentOrganisationAccount();

  return (
    <DashboardShell basePath="/dashboard" orgName={organisation.name}>
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="grid gap-4">
          <h2 className="text-2xl font-semibold text-neutral-950">Settings</h2>
          <StripeConnectSettings orgSlug={organisation.slug} />
        </div>
      </div>
    </DashboardShell>
  );
}
