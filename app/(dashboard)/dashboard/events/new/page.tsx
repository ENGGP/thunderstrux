import { CreateEventForm } from "@/components/events/create-event-form";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { requireManagementPage } from "@/lib/auth/page-access";
import { memberPricesOnSale } from "@/lib/memberships/offers";
import { readChargeReadiness, readTimeZone } from "@/lib/organisations/profile";

export default async function NewEventPage() {
  const organisation = await requireManagementPage("events:manage", "/dashboard/events/new");
  const [timeZone, chargesReady, memberPrices] = await Promise.all([readTimeZone(organisation.id), readChargeReadiness(organisation.id), memberPricesOnSale(organisation.id)]);

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader breadcrumbs={[{ label: "Events", href: "/dashboard/events" }]} title="New event" />
      <CreateEventForm chargesReady={chargesReady} memberPricesOnSale={memberPrices} organisationId={organisation.id} orgSlug={organisation.slug} timeZone={timeZone} />
    </DashboardShell>
  );
}
