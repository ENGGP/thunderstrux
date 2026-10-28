import Link from "next/link";
import { EventActions } from "@/components/events/event-actions";
import { PageHeader } from "@/components/layout/page-header";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { TabLabel, tabBarClasses, tabClasses } from "@/components/ui/link-tabs";
import type { DashboardEvent } from "@/lib/events/event-lifecycle";
import { formatDateRange, formatDateTime } from "@/lib/format";
import {
  hasOrganisationPermission,
  type OrganisationPermission,
  type OrganisationStaffRole
} from "@/lib/permissions";
import { mfaEnforcementMode } from "@/lib/security/staff-mfa";
import { zoneCity } from "@/lib/zoned-time";

export type EventTab = "summary" | "attendees" | "orders" | "edit" | "preview";

// Selling state of a published event, beside its Published badge.
export function SaleBadge({ event }: { event: Pick<DashboardEvent, "status" | "salesOpen" | "soldOut" | "cancelledAt"> }) {
  if (event.status !== "published") return null;
  if (event.cancelledAt) return <StatusBadge label="Event cancelled" status="cancelled" />;
  return <StatusBadge status={!event.salesOpen ? "sales-closed" : event.soldOut ? "sold-out" : "sales-open"} />;
}

// Link tabs share one look, now in components/ui/link-tabs (T19a).
export { tabBarClasses, tabClasses };

const sections: Array<{ id: EventTab; label: string; permission: OrganisationPermission }> = [
  { id: "summary", label: "Summary", permission: "analytics:read" },
  { id: "attendees", label: "Attendees", permission: "tickets:check_in" },
  { id: "orders", label: "Orders", permission: "orders:read" },
  { id: "edit", label: "Edit", permission: "events:manage" },
  // Drafts only: a published event's header links its real public page instead.
  { id: "preview", label: "Preview", permission: "events:manage" }
];

// Header and section tabs for every page of one event. Each page has passed
// its own guard and 404 decision first. Tabs follow the viewer's permissions
// and are left out when only one would show.
export function EventWorkspaceHeader({
  event,
  staffRole,
  active
}: {
  event: DashboardEvent;
  staffRole: OrganisationStaffRole;
  active: EventTab;
}) {
  const base = `/dashboard/events/${event.id}`;
  const hrefs: Record<EventTab, string> = {
    summary: base,
    attendees: `${base}/tickets`,
    orders: `/dashboard/orders?eventId=${event.id}`,
    edit: `${base}/edit`,
    preview: `${base}/preview`
  };
  const tabs = sections.filter(
    (tab) => hasOrganisationPermission(staffRole, tab.permission) && (tab.id !== "preview" || event.status === "draft")
  );
  const editing = active === "edit";
  const canManage = hasOrganisationPermission(staffRole, "events:manage");

  return (
    <div className="grid gap-6">
      <PageHeader
        actions={
          editing ? null : canManage ? (
            <EventActions
              cancel={hasOrganisationPermission(staffRole, "orders:refund") ? { needsCode: mfaEnforcementMode() !== "off" } : null}
              event={event}
              inHeader
              size="md"
            />
          ) : event.status === "published" ? (
            <Link className="text-sm font-semibold text-brand underline underline-offset-4" href={`/events/${event.id}`}>
              View public page
            </Link>
          ) : null
        }
        badge={
          <span className="flex flex-wrap gap-2">
            <StatusBadge status={event.status} />
            {editing ? null : <SaleBadge event={event} />}
          </span>
        }
        breadcrumbs={[
          { label: "Events", href: "/dashboard/events" },
          ...(editing ? [{ label: event.title, href: base }] : [])
        ]}
        description={
          editing ? undefined : (
            <span className="flex flex-wrap gap-x-5 gap-y-1.5">
              <span className="inline-flex items-center gap-2">
                <Icon name="calendar" />
                {formatDateRange(event.startTime, event.endTime, event.timeZone)}, {zoneCity(event.timeZone)}
              </span>
              <span className="inline-flex items-center gap-2 [overflow-wrap:anywhere]">
                <Icon name="pin" />
                {event.location}
              </span>
              <span>Sales close {formatDateTime(event.salesCloseAt, { timeZone: event.timeZone })}</span>
            </span>
          )
        }
        title={editing ? "Edit event" : event.title}
      />
      {tabs.length > 1 ? (
        <nav aria-label="Event sections" className={tabBarClasses}>
          {tabs.map((tab) => (
            <Link
              aria-current={tab.id === active ? "page" : undefined}
              aria-label={tab.id === "orders" ? "Orders for this event" : undefined}
              className={tabClasses(tab.id === active)}
              href={hrefs[tab.id]}
              key={tab.id}
            >
              <TabLabel>{tab.label}</TabLabel>
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
