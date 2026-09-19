import { EventsList } from "@/components/events/events-list";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { requireManagementPage } from "@/lib/auth/page-access";

export default async function EventsPage() {
  const organisation = await requireManagementPage("events:manage", "/dashboard/events");

  return (
    <DashboardShell basePath="/dashboard" orgName={organisation.name}>
      <div className="mx-auto max-w-5xl px-6 py-10">
        <EventsList basePath="/dashboard" orgSlug={organisation.slug} />
      </div>
    </DashboardShell>
  );
}
