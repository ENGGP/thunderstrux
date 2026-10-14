import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { MemberProfileForm } from "@/components/account/member-profile-form";
import { MemberOrganisationsList } from "@/components/organisations/member-organisations-list";
import {
  OrganisationAccessError,
  StaffMfaRequiredError,
  getAccessibleOrganisationsForCurrentAccount,
  requireAuthenticatedUser,
  requireCurrentOrganisationAccount
} from "@/lib/auth/access";
import { readMemberProfile } from "@/lib/auth/account-settings";
import {
  bootstrapOrganisationId,
  contextChoices,
  readAccountContext,
  type ContextChoices
} from "@/lib/auth/context";
import { PersonalShell } from "@/components/layout/personal-shell";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { listDashboardEvents } from "@/lib/events/event-lifecycle";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { getUpcomingTicketOrders } from "@/lib/orders/member-tickets";
import { getOrganisationOverview } from "@/lib/organisations/overview";
import {
  hasOrganisationPermission,
  type OrganisationPermission,
  type OrganisationStaffRole
} from "@/lib/permissions";

function monthStart() {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}

async function OrganisationDashboard(contexts: ContextChoices) {
  // The account and permission checks finish before anything streams.
  const organisation = await requireCurrentOrganisationAccount();

  return (
    <DashboardShell contexts={contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <div className="mx-auto grid max-w-admin grid-cols-1 gap-6 px-4 py-8 sm:px-8">
        <PageHeader
          actions={
            hasOrganisationPermission(organisation.staffRole, "events:manage") ? (
              <Link className={buttonClasses()} href="/dashboard/events/new">
                New event
              </Link>
            ) : null
          }
          title="Overview"
        />
        <Suspense fallback={<OverviewSkeleton />}>
          <OrganisationOverview organisation={organisation} />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

function OverviewSkeleton() {
  return (
    <>
      <div className="grid gap-6 sm:grid-cols-2">
        <Skeleton className="h-32 rounded-card" />
        <Skeleton className="h-32 rounded-card" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <ListSkeleton label="Loading upcoming events" />
        <ListSkeleton label="Loading recent orders" />
      </div>
    </>
  );
}

async function OrganisationOverview({
  organisation
}: {
  organisation: { id: string; name: string; staffRole: OrganisationStaffRole };
}) {
  const can = (permission: OrganisationPermission) =>
    hasOrganisationPermission(organisation.staffRole, permission);
  const startOfMonth = monthStart();
  const canViewOrders = can("orders:read");
  const showSales = can("analytics:read");
  const [{ profileComplete, chargesReady, recentOrders, monthlyPaidOrders }, upcoming] =
    await Promise.all([
      getOrganisationOverview(organisation.id, {
        includeOrders: canViewOrders,
        paidSince: startOfMonth
      }),
      listDashboardEvents(organisation.id, {
        view: "upcoming",
        publishedOnly: organisation.staffRole === "check_in_staff",
        includeSales: showSales,
        take: 5
      })
    ]);
  const monthlyRevenue = monthlyPaidOrders.reduce(
    (total, order) => total + order.totalAmount,
    0
  );
  const next = upcoming.events[0];
  // Only tasks the caller is allowed to act on. Amber only where sales are blocked.
  const tasks = [
    !chargesReady && can("stripe:manage")
      ? {
          tone: "warning" as const,
          title: "Finish payment setup",
          text: "Paid tickets cannot be sold until your Stripe account is connected.",
          href: "/dashboard/settings",
          link: "Set up payments"
        }
      : null,
    !profileComplete && can("organisation:settings")
      ? {
          tone: "info" as const,
          title: "Finish your public society profile",
          text: "Add a description and a contact email so students know who you are.",
          href: "/dashboard/settings/profile",
          link: "Edit society profile"
        }
      : null,
    upcoming.counts.upcoming === 0 && can("events:manage")
      ? {
          tone: "info" as const,
          title: "Schedule an event",
          text: "Nothing is coming up. Create an event and publish it when tickets are ready.",
          href: "/dashboard/events/new",
          link: "Create an event"
        }
      : null
  ].filter((task) => task !== null);
  const linkClass = "font-semibold text-ink underline-offset-4 hover:underline [overflow-wrap:anywhere]";
  const moreLink = "text-sm font-semibold text-brand underline underline-offset-4";

  return (
    <>
      {tasks.length > 0 ? (
        <Card>
          <h2 className="text-xl font-semibold text-ink">Finish setting up</h2>
          <ul className="mt-4 grid gap-3">
            {tasks.map((task) => (
              <li key={task.href}>
                <Notice
                  action={
                    <Link className={moreLink} href={task.href}>
                      {task.link}
                    </Link>
                  }
                  title={task.title}
                  tone={task.tone}
                >
                  {task.text}
                </Notice>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <p className="text-sm font-semibold text-ink-soft">Upcoming events</p>
          <p className="mt-1.5 text-[28px] font-semibold leading-tight tabular-nums text-ink">
            {upcoming.counts.upcoming}
          </p>
          <p className="mt-1 text-sm text-ink-muted [overflow-wrap:anywhere]">
            {next ? `Next: ${next.title}, ${formatDate(next.startTime)}` : "Nothing scheduled"}
          </p>
        </Card>
        {canViewOrders ? (
          <Card>
            <p className="text-sm font-semibold text-ink-soft">Revenue this month</p>
            <p className="mt-1.5 text-[28px] font-semibold leading-tight tabular-nums text-ink">
              {formatMoney(monthlyRevenue)}
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              Paid orders since {formatDate(startOfMonth)}
            </p>
          </Card>
        ) : null}
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">Upcoming events</h2>
            <Link className={moreLink} href="/dashboard/events">
              View all events
            </Link>
          </div>
          {upcoming.events.length === 0 ? (
            <p className="text-sm text-ink-soft">No upcoming events.</p>
          ) : (
            <ul className="grid">
              {upcoming.events.map((event) => (
                <li
                  className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-0"
                  key={event.id}
                >
                  <div className="grid min-w-0 gap-0.5">
                    <Link
                      className={linkClass}
                      href={showSales ? `/dashboard/events/${event.id}` : `/dashboard/events/${event.id}/tickets`}
                    >
                      {event.title}
                    </Link>
                    <span className="text-sm text-ink-soft">
                      {formatDateTime(event.startTime)}
                      {event.status === "draft"
                        ? " · not on sale yet"
                        : event.sold !== null
                          ? ` · ${event.sold} sold · ${event.remaining} left`
                          : ""}
                    </span>
                  </div>
                  <StatusBadge status={event.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {canViewOrders ? (
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-ink">Recent orders</h2>
              <Link className={moreLink} href="/dashboard/orders">
                View all orders
              </Link>
            </div>
            {recentOrders.length === 0 ? (
              <p className="text-sm text-ink-soft">No orders yet.</p>
            ) : (
              <ul className="grid">
                {recentOrders.map((order) => (
                  <li
                    className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-0"
                    key={order.id}
                  >
                    <div className="grid min-w-0 gap-0.5">
                      {/* Order detail serves settled orders only, so a pending one is not a link. */}
                      {order.status === "pending" ? (
                        <span className="font-semibold text-ink [overflow-wrap:anywhere]">{order.event.title}</span>
                      ) : (
                        <Link className={linkClass} href={`/dashboard/orders/${order.id}`}>
                          {order.event.title}
                        </Link>
                      )}
                      <span className="text-sm text-ink-soft">
                        {order.quantity} ticket{order.quantity === 1 ? "" : "s"} ·{" "}
                        {formatDateTime(order.createdAt)}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-sm font-semibold tabular-nums text-ink">
                        {formatMoney(order.totalAmount)}
                      </span>
                      <StatusBadge status={order.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}

async function MemberDashboard(userId: string, contexts: ContextChoices) {
  const [user, upcoming, organisations] = await Promise.all([
    readMemberProfile(userId),
    getUpcomingTicketOrders(userId),
    getAccessibleOrganisationsForCurrentAccount()
  ]);

  return (
    <PersonalShell contexts={contexts}>
      <h1 className="text-3xl font-semibold text-ink">Overview</h1>

      {!user?.onboardingCompletedAt ? (
        <Card>
          <h2 className="text-xl font-semibold text-ink">Complete your profile</h2>
          <div className="mt-4">
            <MemberProfileForm
              initialProfile={{
                displayName: user?.displayName ?? "",
                firstName: user?.firstName ?? "",
                lastName: user?.lastName ?? "",
                phone: user?.phone ?? "",
                studentNumber: user?.studentNumber ?? ""
              }}
            />
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-ink">Upcoming tickets</h2>
          <Link className="text-sm font-semibold text-brand underline" href="/tickets">
            All tickets
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">
            You have no upcoming tickets.{" "}
            <Link className="text-brand underline" href="/">
              Browse events
            </Link>
          </p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {upcoming.map((order) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line p-4"
                key={order.id}
              >
                <div className="min-w-0">
                  <p className="font-semibold text-ink [overflow-wrap:anywhere]">
                    {order.event.title}
                  </p>
                  <p className="text-sm text-ink-soft">
                    {formatDateTime(order.event.startTime, {
                      timeZone: order.event.organisation.timeZone
                    })}{" "}
                    · {order.event.location}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {order.quantity} × {order.ticketType.name} ·{" "}
                    {order.event.organisation.name}
                  </p>
                </div>
                <Link
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                  href="/tickets"
                >
                  View ticket
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-ink">Your societies</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Societies you have joined for free.
            </p>
          </div>
          <Link
            className={buttonClasses({ size: "sm" })}
            href="/dashboard/organisations"
          >
            Find societies
          </Link>
        </div>

        <MemberOrganisationsList organisations={organisations} />
      </Card>
    </PersonalShell>
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
  return MemberDashboard(user.id, contextChoices(context));
}
