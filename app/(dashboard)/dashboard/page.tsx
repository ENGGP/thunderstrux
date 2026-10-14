import Link from "next/link";
import { redirect } from "next/navigation";
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
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { getUpcomingTicketOrders } from "@/lib/orders/member-tickets";
import { getOrganisationOverview } from "@/lib/organisations/overview";
import { hasOrganisationPermission, type OrganisationPermission } from "@/lib/permissions";

function monthStart() {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}

async function OrganisationDashboard(contexts: ContextChoices) {
  const organisation = await requireCurrentOrganisationAccount();
  const startOfMonth = monthStart();
  const canManageEvents = hasOrganisationPermission(
    organisation.staffRole,
    "events:manage"
  );
  const canViewOrders = hasOrganisationPermission(organisation.staffRole, "orders:read");

  const can = (permission: OrganisationPermission) =>
    hasOrganisationPermission(organisation.staffRole, permission);
  const { profileComplete, chargesReady, upcomingEvents, recentOrders, monthlyPaidOrders } =
    await getOrganisationOverview(organisation.id, {
      publishedEventsOnly: organisation.staffRole === "check_in_staff",
      includeOrders: canViewOrders,
      paidSince: startOfMonth
    });

  const monthlyRevenue = monthlyPaidOrders.reduce(
    (total, order) => total + order.totalAmount,
    0
  );
  // Only tasks the caller is allowed to act on.
  const tasks = [
    !profileComplete && can("organisation:settings")
      ? { text: "Finish your public society profile", href: "/dashboard/settings/profile", link: "Open settings" }
      : null,
    !chargesReady && can("stripe:manage")
      ? { text: "Finish payment setup before selling paid tickets", href: "/dashboard/settings", link: "Open Payments" }
      : null,
    upcomingEvents.length === 0 && canManageEvents
      ? { text: "No upcoming events are scheduled", href: "/dashboard/events/new", link: "Create an event" }
      : null
  ].filter((task) => task !== null);

  return (
    <DashboardShell contexts={contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <div className="mx-auto grid max-w-admin gap-6 px-4 py-8 sm:px-8">
        <PageHeader
          actions={
            canManageEvents ? (
              <Link className={buttonClasses()} href="/dashboard/events/new">
                New event
              </Link>
            ) : null
          }
          title="Overview"
        />

        {tasks.length > 0 ? (
          <Card>
            <h2 className="text-lg font-semibold text-ink">Needs attention</h2>
            <ul className="mt-3 grid gap-2">
              {tasks.map((task) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 rounded-control border-l-[3px] border-warning bg-warning-bg px-4 py-3 text-sm text-warning"
                  key={task.href}
                >
                  <span>{task.text}</span>
                  <Link className="font-semibold underline" href={task.href}>
                    {task.link}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2">
          <Card>
            <p className="text-sm text-ink-muted">Upcoming events</p>
            <p className="mt-1 text-2xl font-semibold text-ink">
              {upcomingEvents.length}
              {upcomingEvents.length === 5 ? "+" : ""}
            </p>
            <p className="mt-1 text-sm text-ink-muted">Next five shown below</p>
          </Card>
          {canViewOrders ? (
            <Card>
              <p className="text-sm text-ink-muted">Revenue this month</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
                {formatMoney(monthlyRevenue)}
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                Paid ticket orders since {formatDate(startOfMonth)}
              </p>
            </Card>
          ) : null}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card>
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-ink">Upcoming events</h2>
              <Link className="text-sm font-semibold text-brand underline" href="/dashboard/events">
                View all
              </Link>
            </div>
            {upcomingEvents.length === 0 ? (
              <p className="text-sm text-ink-soft">No upcoming events.</p>
            ) : (
              <ul className="grid gap-3">
                {upcomingEvents.map((event) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line p-3 text-sm"
                    key={event.id}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-ink [overflow-wrap:anywhere]">{event.title}</p>
                      <p className="mt-1 text-ink-muted">{formatDate(event.startTime)}</p>
                    </div>
                    <StatusBadge status={event.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {canViewOrders ? (
            <Card>
              <div className="mb-4 flex items-center justify-between gap-4">
                <h2 className="text-lg font-semibold text-ink">Recent orders</h2>
                <Link className="text-sm font-semibold text-brand underline" href="/dashboard/orders">
                  View all
                </Link>
              </div>
              {recentOrders.length === 0 ? (
                <p className="text-sm text-ink-soft">No orders yet.</p>
              ) : (
                <ul className="grid gap-3">
                  {recentOrders.map((order) => (
                    <li
                      className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line p-3 text-sm"
                      key={order.id}
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-ink [overflow-wrap:anywhere]">
                          {order.event.title}
                        </p>
                        <p className="mt-1 text-ink-muted">
                          {order.quantity} ticket{order.quantity === 1 ? "" : "s"} ·{" "}
                          <span className="tabular-nums">{formatMoney(order.totalAmount)}</span>
                        </p>
                      </div>
                      <StatusBadge status={order.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
        </section>
      </div>
    </DashboardShell>
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
