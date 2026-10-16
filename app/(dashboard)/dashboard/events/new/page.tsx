import { CreateEventForm } from "@/components/events/create-event-form";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { requireManagementPage } from "@/lib/auth/page-access";
import { readTimeZone } from "@/lib/organisations/profile";

export default async function NewEventPage() {
  const organisation = await requireManagementPage("events:manage", "/dashboard/events/new");
  const timeZone = await readTimeZone(organisation.id);

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader breadcrumbs={[{ label: "Events", href: "/dashboard/events" }]} title="New event" />
      <CreateEventForm organisationId={organisation.id} orgSlug={organisation.slug} timeZone={timeZone} />
    </DashboardShell>
  );
}
