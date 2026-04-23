import { StripeConnectSettings } from "@/components/settings/stripe-connect-settings";

export default async function SettingsPage({
  params
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  return (
    <div className="grid gap-4">
      <h2 className="text-2xl font-semibold text-neutral-950">Settings</h2>
      <StripeConnectSettings orgSlug={orgSlug} />
    </div>
  );
}
