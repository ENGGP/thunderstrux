import { CreateEventForm } from "@/components/events/create-event-form";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { requireManagementPage } from "@/lib/auth/page-access";

export default async function NewEventPage() {
  const organisation = await requireManagementPage("events:manage", "/dashboard/events/new");

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <div className="mx-auto max-w-5xl px-6 py-10">
        <CreateEventForm basePath="/dashboard" orgSlug={organisation.slug} />
      </div>
    </DashboardShell>
  );
}
