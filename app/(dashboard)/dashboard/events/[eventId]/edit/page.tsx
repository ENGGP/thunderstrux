import type { Metadata } from "next";
import { entitlementOnSale } from "@/lib/memberships/offers";
import { notFound } from "next/navigation";
import { CreateEventForm } from "@/components/events/create-event-form";
import { EventWorkspaceHeader } from "@/components/events/event-tabs";
import { ReadinessChecklist } from "@/components/events/readiness-checklist";
import { TicketCodesEditor } from "@/components/events/ticket-codes-editor";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { requireManagementPage } from "@/lib/auth/page-access";
import {
  EventLifecycleNotFoundError,
  getDashboardEvent,
  getOrganisationEventForEditing
} from "@/lib/events/event-lifecycle";
import { describeCode, listEventTicketCodes } from "@/lib/events/ticket-codes";
import { readChargeReadiness } from "@/lib/organisations/profile";

export const metadata: Metadata = { title: "Edit event" };

export default async function EditEventPage({
  params
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const organisation = await requireManagementPage("events:manage", `/dashboard/events/${eventId}/edit`);

  let initialEvent: Awaited<ReturnType<typeof getOrganisationEventForEditing>>;
  let event: Awaited<ReturnType<typeof getDashboardEvent>>;
  let chargesReady: boolean;
  let memberPrices: boolean;
  let membersOnly: boolean;
  let codes: Awaited<ReturnType<typeof listEventTicketCodes>>;

  try {
    [initialEvent, event, chargesReady, memberPrices, membersOnly, codes] = await Promise.all([
      getOrganisationEventForEditing(organisation.id, eventId),
      getDashboardEvent(organisation.id, eventId),
      readChargeReadiness(organisation.id),
      entitlementOnSale(organisation.id, "member_prices"),
      entitlementOnSale(organisation.id, "members_only_events"),
      listEventTicketCodes(organisation.id, eventId)
    ]);
  } catch (error) {
    if (error instanceof EventLifecycleNotFoundError) {
      notFound();
    }

    throw error;
  }

  if (event.cancelledAt) {
    return (
      <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
        <EventWorkspaceHeader active="edit" event={event} staffRole={organisation.staffRole} />
        <Notice title="This event was cancelled">It can&apos;t be edited any more. Its orders, refunds and attendance stay in Orders and History.</Notice>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <EventWorkspaceHeader active="edit" event={event} staffRole={organisation.staffRole} />
      {event.status === "published" ? (
        <Notice>
          This event is published. Changes show on the public page as soon as
          you save. Ticket holders get an email only if you change the time or
          place.
        </Notice>
      ) : null}
      <CreateEventForm
        chargesReady={chargesReady}
        memberPricesOnSale={memberPrices}
        membersOnlyOnSale={membersOnly}
        aside={
          event.status === "draft" ? (
            <Card>
              <div className="grid gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-ink" id="ready-heading">Ready to publish?</h2>
                  <p className="mt-1 text-sm text-ink-soft">Checked when you save. Publish from the Summary.</p>
                </div>
                <ReadinessChecklist blockers={event.blockers} warnings={event.warnings} />
              </div>
            </Card>
          ) : null
        }
        eventId={eventId}
        initialEvent={initialEvent}
        mode="edit"
        organisationId={organisation.id}
        orgSlug={organisation.slug}
        timeZone={event.timeZone}
        after={
          <TicketCodesEditor
            codes={codes.map((code) => ({
              id: code.id,
              code: code.code,
              gives: describeCode(code, code.ticketTypeName),
              used: code.used,
              maxUses: code.maxUses,
              endsAt: code.endsAt?.toISOString() ?? null,
              disabledAt: code.disabledAt?.toISOString() ?? null
            }))}
            eventId={eventId}
            ticketTypes={initialEvent.ticketTypes}
            timeZone={event.timeZone}
          />
        }
      />
    </DashboardShell>
  );
}
