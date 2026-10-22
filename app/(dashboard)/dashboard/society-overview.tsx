import Link from "next/link";
import type { ReactNode } from "react";
import { formatDay, formatTime, localDay } from "@/components/calendar/layout";
import { DateRail } from "@/components/events/date-rail";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, type IconName } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { analyticsAccess, societySales, ticketMetrics } from "@/lib/analytics/metrics";
import { analyticsRange, localToday } from "@/lib/analytics/range";
import { listDashboardEvents } from "@/lib/events/event-lifecycle";
import { formatDate, formatMoney, formatPrice } from "@/lib/format";
import { getDoorDay, getOrganisationOverview, type RecentOrder } from "@/lib/organisations/overview";
import { orderReference } from "@/lib/payments/order-refunds";
import { ticketOrderProjection } from "@/lib/purchases/projection";
import { hasOrganisationPermission, type OrganisationPermission, type OrganisationStaffRole } from "@/lib/permissions";

// The society Overview (T34, design round C1): what needs doing first, then a
// few honestly labelled numbers, upcoming events and recent orders. Every task
// and number shows only to a role that may see it and act on it.

type Society = { id: string; name: string; staffRole: OrganisationStaffRole };
type Task = { key: string; icon: IconName; warn?: boolean; title: string; text: string; href: string; link: string; setup?: boolean };

const moreLink = "text-sm font-semibold text-brand underline underline-offset-4";
const titleLink = "font-semibold text-ink underline-offset-4 hover:underline [overflow-wrap:anywhere]";
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export async function SocietyOverview({ organisation, timeZone }: { organisation: Society; timeZone: string }) {
  const can = (permission: OrganisationPermission) => hasOrganisationPermission(organisation.staffRole, permission);
  const today = localToday(timeZone);
  const thisMonth = analyticsRange({ from: `${today.slice(0, 8)}01`, to: today }, timeZone);
  const access = analyticsAccess(organisation.staffRole);
  const [overview, upcoming, sales, issued] = await Promise.all([
    getOrganisationOverview(organisation.id, organisation.staffRole),
    listDashboardEvents(organisation.id, { view: "upcoming", publishedOnly: false, includeSales: can("analytics:read"), take: 5 }),
    societySales(organisation.id, thisMonth, access),
    can("analytics:read") && !access.financial ? ticketMetrics(organisation.id, thisMonth, access).then((metrics) => metrics.totals.ticketsIssued) : null
  ]);
  const since = formatDate(`${thisMonth.from}T12:00:00Z`, "UTC");
  const eventHref = (id: string) => (can("analytics:read") ? `/dashboard/events/${id}` : `/dashboard/events/${id}/tickets`);

  const tasks: Task[] = [];
  if (!overview.chargesReady && can("stripe:manage")) tasks.push({ key: "payments", icon: "warning", warn: true, setup: true, title: "Set up payments", text: "Needed for paid tickets, memberships and merchandise. Free events can be published now.", href: "/dashboard/settings", link: "Set up payments" });
  if (!overview.profileComplete && can("organisation:settings")) tasks.push({ key: "profile", icon: "profile", setup: true, title: "Finish your society profile", text: "Add a description and a contact email so students know who you are.", href: "/dashboard/settings/profile", link: "Edit society profile" });
  if (!overview.hasEvents && can("events:manage")) tasks.push({ key: "first-event", icon: "calendar", setup: true, title: "Schedule your first event", text: "It stays a draft until you publish it.", href: "/dashboard/events/new", link: "New event" });
  if (overview.reviews) tasks.push({ key: "reviews", icon: "warning", warn: true, title: `${plural(overview.reviews, "payment")} in review`, text: "People paid but what they bought couldn't be issued. Decide on each one.", href: "/dashboard/orders", link: "Review payments" });
  if (overview.pickups?.preparing) {
    const { preparing, oldest, ready } = overview.pickups;
    tasks.push({ key: "pickups", icon: "bag", title: `${plural(preparing, "merchandise order")} to prepare`, text: `${oldest ? `The oldest was paid on ${formatDate(oldest, timeZone)}.` : ""}${ready ? ` ${ready} more ${ready === 1 ? "is" : "are"} ready and waiting to be collected.` : ""}`.trim(), href: "/dashboard/merchandise/pickups", link: "Open Pickups" });
  }
  if (overview.ending?.count) {
    const plan = !overview.ending.nextOnSale && can("memberships:manage");
    tasks.push({ key: "ending", icon: "badge", title: `${plural(overview.ending.count, "membership")} end in the next 7 days`, text: `Members get a reminder. Your next membership ${overview.ending.nextOnSale ? "is on sale." : "isn't on sale yet."}`, href: plan ? "/dashboard/memberships/new" : "/dashboard/memberships/members", link: plan ? "Plan the next membership" : "Open Members" });
  }
  if (overview.failedEmails) tasks.push({ key: "emails", icon: "mail", title: `${plural(overview.failedEmails, "email")} couldn't be delivered`, text: "Check each one and send it again from Email delivery.", href: "/dashboard/notifications", link: "Open Email delivery" });
  for (const draft of overview.drafts) tasks.push({ key: `draft-${draft.id}`, icon: "calendar", title: `${draft.title} is still a draft`, text: `It starts ${formatDay(localDay(draft.startTime, timeZone))}.`, href: eventHref(draft.id), link: "Open the event" });
  const settingUp = tasks.length > 0 && tasks.every((task) => task.setup);

  const tiles: Array<{ label: string; value: string; note: ReactNode }> = [
    {
      label: "Upcoming events",
      value: String(upcoming.counts.upcoming),
      note: upcoming.events[0] ? `Next: ${upcoming.events[0].title}, ${formatDay(localDay(upcoming.events[0].startTime, timeZone))}, ${formatTime(upcoming.events[0].startTime, timeZone)}` : "Nothing scheduled yet"
    }
  ];
  if (sales) tiles.push({ label: "Sales this month", value: formatMoney(sales.total), note: <>Gross since {since}: tickets, memberships and merchandise. <Link className="font-semibold text-brand underline underline-offset-4" href="/dashboard/analytics">See analytics</Link></> });
  else if (issued !== null) tiles.push({ label: "Tickets issued this month", value: String(issued), note: `Since ${since}, paid and free` });
  if (overview.membersNow !== null) tiles.push({ label: "Members now", value: String(overview.membersNow), note: "Holding a membership today" });

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <Card className="lg:col-span-2">
        <h2 className="text-xl font-semibold text-ink">{settingUp ? `Get ${organisation.name} ready` : "Needs your attention"}</h2>
        {settingUp && tasks.some((task) => task.key === "payments") ? <p className="mt-1 text-sm text-ink-soft">You can publish free events before payments are set up.</p> : null}
        {tasks.length ? (
          <ul className="mt-4 grid gap-3">
            {tasks.map((task) => (
              <li className={`flex flex-wrap items-center gap-x-3.5 gap-y-1 rounded-control border px-4 py-3.5 ${task.warn ? "border-warning-border bg-warning-bg" : "border-line bg-surface"}`} key={task.key}>
                <Icon className={task.warn ? "text-warning-icon" : "text-brand"} name={task.icon} />
                <div className="grid min-w-0 flex-[1_1_18rem] gap-0.5">
                  <p className="font-semibold text-ink [overflow-wrap:anywhere]">{task.title}</p>
                  {task.text ? <p className="text-sm text-ink-soft">{task.text}</p> : null}
                </div>
                <Link className={`inline-flex min-h-11 items-center ${moreLink}`} href={task.href}>{task.link}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4 flex items-center gap-3 rounded-control border border-success-border bg-success-bg px-4 py-3.5">
            <Icon className="text-success-icon" name="success" />
            <div>
              <p className="font-semibold text-success">All caught up</p>
              <p className="text-sm text-ink-soft">Nothing here needs you right now.</p>
            </div>
          </div>
        )}
      </Card>

      <div className={`order-2 grid gap-6 sm:grid-cols-2 lg:order-none lg:col-span-2 ${tiles.length === 3 ? "lg:grid-cols-3" : ""}`}>
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <p className="text-sm font-semibold text-ink-soft">{tile.label}</p>
            <p className="mt-1.5 text-[28px] font-semibold leading-tight tabular-nums text-ink">{tile.value}</p>
            <p className="mt-1 text-sm text-ink-muted [overflow-wrap:anywhere]">{tile.note}</p>
          </Card>
        ))}
      </div>

      <Card className="order-1 lg:order-none">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">Upcoming events</h2>
          <Link className={moreLink} href="/dashboard/calendar">Open calendar</Link>
        </div>
        {upcoming.events.length === 0 ? (
          <p className="text-sm text-ink-soft">No upcoming events.</p>
        ) : (
          <ul className="grid">
            {upcoming.events.map((event) => (
              <li className="flex items-center gap-3 border-t border-line py-3 first:border-0" key={event.id}>
                <DateRail date={event.startTime} size="md" timeZone={timeZone} />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <Link className={titleLink} href={eventHref(event.id)}>{event.title}</Link>
                  <span className="text-sm text-ink-soft">
                    {formatDay(localDay(event.startTime, timeZone)).split(" ")[0]} {formatTime(event.startTime, timeZone)}
                    {event.status === "draft" ? " · not on sale yet" : event.sold !== null ? ` · ${event.sold} sold · ${event.remaining} left` : ""}
                  </span>
                </div>
                <StatusBadge status={event.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {can("orders:read") ? (
        <Card className="order-3 lg:order-none">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">Recent orders</h2>
            <Link className={moreLink} href="/dashboard/orders">View all orders</Link>
          </div>
          {overview.recentOrders.length === 0 ? (
            <p className="text-sm text-ink-soft">No orders yet.</p>
          ) : (
            <ul className="grid">
              {overview.recentOrders.map((row) => <RecentOrderRow key={`${row.family}-${row.order.id}`} row={row} timeZone={timeZone} />)}
            </ul>
          )}
        </Card>
      ) : null}

      <p className="order-4 text-sm text-ink-muted lg:order-none lg:col-span-2">
        Money, recent orders and payment reviews show to owners, admins and finance managers. Members now shows to staff who can see members. Times are in the society&apos;s zone.
      </p>
    </div>
  );
}

const familyLabel = { ticket: "Ticket", membership: "Membership", merchandise: "Merch" } as const;

function RecentOrderRow({ row, timeZone }: { row: RecentOrder; timeZone: string }) {
  let title: string;
  let detail: string;
  let href: string | null;
  if (row.family === "ticket") {
    title = row.order.event.title;
    detail = plural(row.order.quantity, "ticket");
    // Order detail serves settled orders only, so a pending one is not a link.
    href = row.order.status === "pending" ? null : `/dashboard/orders/${row.order.id}`;
  } else {
    const [first, ...rest] = row.order.lines;
    title = row.family === "merchandise" ? `Order ${orderReference(row.order.id)}` : (first?.nameSnapshot ?? "Membership");
    detail = row.family === "merchandise" ? plural(row.order.lines.reduce((sum, line) => sum + line.quantity, 0), "item") : rest.length ? `${rest.length + 1} plans` : "Membership";
    href = row.family === "merchandise" ? `/dashboard/merchandise/orders/${row.order.id}` : first?.membershipGrant ? `/dashboard/memberships/members/${first.membershipGrant.id}` : null;
  }
  const name = (
    <>
      <span className="mr-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">{familyLabel[row.family]}</span>
      {title}
    </>
  );
  return (
    <li className="flex items-center gap-3 border-t border-line py-3 first:border-0">
      <div className="grid min-w-0 flex-1 gap-0.5">
        {href ? <Link className={titleLink} href={href}>{name}</Link> : <span className="font-semibold text-ink [overflow-wrap:anywhere]">{name}</span>}
        <span className="text-sm text-ink-soft [overflow-wrap:anywhere]">
          {row.buyer} · {detail} · {formatDate(row.createdAt, timeZone)}, {formatTime(row.createdAt, timeZone)}
        </span>
      </div>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{row.order.paymentKind === "free" ? "Free" : formatPrice(row.order.totalAmount)}</span>
      <StatusBadge status={ticketOrderProjection(row.order)} />
    </li>
  );
}

// Check-in staff: today's door, then the rest of the week. No money, orders,
// drafts or members (design round C1).
export async function DoorOverview({ organisation, timeZone }: { organisation: Society; timeZone: string }) {
  const { todayEvents, later } = await getDoorDay(organisation.id, timeZone);
  return (
    <>
      {todayEvents.length ? (
        <Card>
          <h2 className="text-xl font-semibold text-ink">Events today</h2>
          <ul className="mt-3 grid">
            {todayEvents.map((event, index) => (
              <li className="grid gap-3 border-t border-line py-4 first:border-0 sm:flex sm:items-center sm:justify-between" key={event.id}>
                <div className="grid min-w-0 gap-0.5">
                  <p className="font-semibold text-ink [overflow-wrap:anywhere]">{event.title}</p>
                  <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{formatTime(event.startTime, timeZone)} to {formatTime(event.endTime, timeZone)} · {event.location}</p>
                  <p className="text-sm text-ink-soft">{plural(event.attendance.valid, "ticket")} · {event.attendance.checkedIn} checked in</p>
                </div>
                <Link className={buttonClasses({ variant: index === 0 ? "primary" : "secondary", size: "lg" })} href={`/dashboard/events/${event.id}/tickets`}>
                  Open check-in<span className="sr-only"> for {event.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <EmptyState icon="calendar" title="No events today">
          {later[0] ? `Next: ${later[0].title}, ${formatDay(localDay(later[0].startTime, timeZone))}, ${formatTime(later[0].startTime, timeZone)}.` : "Nothing is scheduled for the next seven days."}
        </EmptyState>
      )}
      {later.length ? (
        <Card>
          <h2 className="text-lg font-semibold text-ink">Later this week</h2>
          <ul className="mt-3 grid">
            {later.map((event) => (
              <li className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-0" key={event.id}>
                <div className="grid min-w-0 gap-0.5">
                  <Link className={titleLink} href={`/dashboard/events/${event.id}/tickets`}>{event.title}</Link>
                  <span className="text-sm text-ink-soft">{formatDay(localDay(event.startTime, timeZone))}, {formatTime(event.startTime, timeZone)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <p className="text-sm text-ink-soft">Check-in staff see published events and their attendees only: no money, orders, drafts or members.</p>
    </>
  );
}
