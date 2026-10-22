import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { formatDay } from "@/components/calendar/layout";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { PersonalShell } from "@/components/layout/personal-shell";
import { buttonClasses } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { localToday } from "@/lib/analytics/range";
import {
  OrganisationAccessError,
  StaffMfaRequiredError,
  requireAuthenticatedUser,
  requireCurrentOrganisationAccount
} from "@/lib/auth/access";
import { bootstrapOrganisationId, contextChoices, readAccountContext, type ContextChoices } from "@/lib/auth/context";
import { readTimeZone } from "@/lib/organisations/profile";
import { hasOrganisationPermission } from "@/lib/permissions";
import { zoneCity } from "@/lib/zoned-time";
import { PersonalOverview } from "./personal-overview";
import { DoorOverview, SocietyOverview } from "./society-overview";

function OverviewSkeleton({ label }: { label: string }) {
  return (
    <div className="grid gap-6">
      <p className="sr-only">{label}</p>
      <Skeleton className="h-32 rounded-card" />
      <div className="grid gap-6 sm:grid-cols-3">
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-24 rounded-card" />
      </div>
    </div>
  );
}

async function OrganisationDashboard(contexts: ContextChoices) {
  // The account and permission checks finish before anything streams.
  const organisation = await requireCurrentOrganisationAccount();
  const timeZone = await readTimeZone(organisation.id);
  // Check-in staff land on today's door (design round C1).
  const door = organisation.staffRole === "check_in_staff";

  return (
    <DashboardShell contexts={contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader
        actions={
          hasOrganisationPermission(organisation.staffRole, "events:manage") ? (
            <Link className={buttonClasses()} href="/dashboard/events/new">
              New event
            </Link>
          ) : null
        }
        description={`${organisation.name} · ${zoneCity(timeZone)} · ${formatDay(localToday(timeZone))}`}
        title={door ? "Today at the door" : "Overview"}
      />
      <Suspense fallback={<OverviewSkeleton label="Loading overview" />}>
        {door ? <DoorOverview organisation={organisation} timeZone={timeZone} /> : <SocietyOverview organisation={organisation} timeZone={timeZone} />}
      </Suspense>
    </DashboardShell>
  );
}

export default async function DashboardPage() {
  const user = await requireAuthenticatedUser();
  const context = await readAccountContext();
  if (context.selected) {
    try {
      return await OrganisationDashboard(contextChoices(context));
    } catch (error) {
      if (error instanceof StaffMfaRequiredError) redirect("/mfa?callbackUrl=/dashboard");
      if (error instanceof OrganisationAccessError) {
        redirect("/dashboard/create");
      }

      throw error;
    }
  }

  if (user.accountRole === "organisation") {
    if (context.organisations.length === 0 && !(await bootstrapOrganisationId(user.id))) redirect("/dashboard/create");
    return (
      <PersonalShell accountRole="organisation" contexts={contextChoices(context)}>
        <h1 className="text-2xl font-semibold">Choose a staff organisation</h1>
        {context.organisations.length === 0 && <p>No active organisation access. Contact an owner.</p>}
      </PersonalShell>
    );
  }
  return (
    <PersonalShell contexts={contextChoices(context)}>
      <h1 className="text-3xl font-semibold text-ink">Overview</h1>
      <Suspense fallback={<OverviewSkeleton label="Loading your overview" />}>
        <PersonalOverview userId={user.id} />
      </Suspense>
    </PersonalShell>
  );
}
