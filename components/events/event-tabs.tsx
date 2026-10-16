import Link from "next/link";
import { EventActions } from "@/components/events/event-actions";
import { PageHeader } from "@/components/layout/page-header";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DashboardEvent } from "@/lib/events/event-lifecycle";
import { formatDateRange, formatDateTime } from "@/lib/format";
import {
  hasOrganisationPermission,
  type OrganisationPermission,
  type OrganisationStaffRole
} from "@/lib/permissions";
import { zoneCity } from "@/lib/zoned-time";

export type EventTab = "summary" | "attendees" | "orders" | "edit";

// Selling state of a published event, beside its Published badge.
export function SaleBadge({ event }: { event: Pick<DashboardEvent, "status" | "salesOpen" | "soldOut"> }) {
  if (event.status !== "published") return null;
  return <StatusBadge status={!event.salesOpen ? "sales-closed" : event.soldOut ? "sold-out" : "sales-open"} />;
}

// Link tabs share one look: the events list views and an event's sections.
// The bar scrolls sideways on narrow screens instead of wrapping.
export const tabBarClasses =
  "flex overflow-x-auto shadow-[inset_0_-1px_0_var(--color-line)] sm:gap-1";

export function tabClasses(active: boolean) {
  return `inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-[3px] px-3 text-[15px] sm:px-4 ${
    active
      ? "border-brand font-semibold text-brand-ink"
      : "border-transparent font-medium text-ink-soft hover:text-ink"
  }`;
}

const sections: Array<{ id: EventTab; label: string; permission: OrganisationPermission }> = [
  { id: "summary", label: "Summary", permission: "analytics:read" },
  { id: "attendees", label: "Attendees", permission: "tickets:check_in" },
  { id: "orders", label: "Orders", permission: "orders:read" },
  { id: "edit", label: "Edit", permission: "events:manage" }
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
    edit: `${base}/edit`
  };
  const tabs = sections.filter((tab) => hasOrganisationPermission(staffRole, tab.permission));
  const editing = active === "edit";
  const canManage = hasOrganisationPermission(staffRole, "events:manage");

  return (
    <div className="grid gap-6">
      <PageHeader
        actions={
          editing ? null : canManage ? (
            <EventActions event={event} inHeader size="md" />
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
              {tab.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
