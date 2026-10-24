import type { Metadata } from "next";
import { CreateEventForm } from "@/components/events/create-event-form";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { requireManagementPage } from "@/lib/auth/page-access";
import { isLocalDate } from "@/lib/events/calendar";
import { entitlementOnSale } from "@/lib/memberships/offers";
import { readChargeReadiness, readTimeZone } from "@/lib/organisations/profile";

export const metadata: Metadata = { title: "New event" };

export default async function NewEventPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const organisation = await requireManagementPage("events:manage", "/dashboard/events/new");
  const [timeZone, chargesReady, memberPrices, membersOnly] = await Promise.all([
    readTimeZone(organisation.id),
    readChargeReadiness(organisation.id),
    entitlementOnSale(organisation.id, "member_prices"),
    entitlementOnSale(organisation.id, "members_only_events")
  ]);

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader breadcrumbs={[{ label: "Events", href: "/dashboard/events" }]} title="New event" />
      <CreateEventForm chargesReady={chargesReady} memberPricesOnSale={memberPrices} membersOnlyOnSale={membersOnly} organisationId={organisation.id} orgSlug={organisation.slug} startDate={isLocalDate(date) ? date : undefined} timeZone={timeZone} />
    </DashboardShell>
  );
}
