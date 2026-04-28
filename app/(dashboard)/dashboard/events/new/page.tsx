import { CreateEventForm } from "@/components/events/create-event-form";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { requireCurrentOrganisationAccount } from "@/lib/auth/access";

export default async function NewEventPage() {
  const organisation = await requireCurrentOrganisationAccount();

  return (
    <DashboardShell basePath="/dashboard" orgName={organisation.name}>
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="grid gap-4">
          <h1 className="text-2xl font-semibold text-neutral-950">Create Event</h1>
          <CreateEventForm basePath="/dashboard" orgSlug={organisation.slug} />
        </div>
      </div>
    </DashboardShell>
  );
}
