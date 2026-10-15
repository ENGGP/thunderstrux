import { CreateEventForm } from "@/components/events/create-event-form";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { requireManagementPage } from "@/lib/auth/page-access";

export default async function NewEventPage() {
  const organisation = await requireManagementPage("events:manage", "/dashboard/events/new");

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader breadcrumbs={[{ label: "Events", href: "/dashboard/events" }]} title="New event" />
      <CreateEventForm basePath="/dashboard" orgSlug={organisation.slug} />
    </DashboardShell>
  );
}
