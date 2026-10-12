import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
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
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { getUpcomingTicketOrders } from "@/lib/orders/member-tickets";
import { getOrganisationOverview } from "@/lib/organisations/overview";
import { hasOrganisationPermission } from "@/lib/permissions";

function monthStart() {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function revenueBuckets(orders: Array<{ paidAt: Date | null; totalAmount: number }>) {
  const buckets = Array.from({ length: 4 }, (_, index) => ({
    label: `W${index + 1}`,
    total: 0
  }));

  for (const order of orders) {
    const paidAt = order.paidAt;

    if (!paidAt) {
      continue;
    }

    const bucketIndex = Math.min(3, Math.floor((paidAt.getDate() - 1) / 7));
    buckets[bucketIndex].total += order.totalAmount;
  }

  return buckets;
}

async function OrganisationDashboard(contexts: ContextChoices) {
  const organisation = await requireCurrentOrganisationAccount();
  const startOfMonth = monthStart();
  const canManageEvents = hasOrganisationPermission(
    organisation.staffRole,
    "events:manage"
  );
  const canViewOrders = hasOrganisationPermission(organisation.staffRole, "orders:read");

  const { upcomingEvents, recentOrders, monthlyPaidOrders } =
    await getOrganisationOverview(organisation.id, {
      publishedEventsOnly: organisation.staffRole === "check_in_staff",
      includeOrders: canViewOrders,
      paidSince: startOfMonth
    });

  const monthlyRevenue = monthlyPaidOrders.reduce(
    (total, order) => total + order.totalAmount,
    0
  );
  const buckets = revenueBuckets(monthlyPaidOrders);
  const maxBucket = Math.max(...buckets.map((bucket) => bucket.total), 1);

  return (
    <DashboardShell contexts={contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-sm text-neutral-500">Organisation dashboard</p>
              <h2 className="mt-2 text-3xl font-semibold text-neutral-950">
                {organisation.name}
              </h2>
            </div>
            {canManageEvents ? (
              <Link
                className="inline-flex items-center justify-center rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700"
                href="/dashboard/events/new"
              >
                New event
              </Link>
            ) : null}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {canViewOrders ? (
            <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-neutral-500">Past month revenue</p>
              <p className="mt-2 text-2xl font-semibold text-neutral-950">
                {formatMoney(monthlyRevenue)}
              </p>
            </div>
          ) : null}
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-neutral-500">Upcoming events</p>
            <p className="mt-2 text-2xl font-semibold text-neutral-950">
              {upcomingEvents.length}
            </p>
          </div>
          {canViewOrders ? (
            <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-neutral-500">Recent orders</p>
              <p className="mt-2 text-2xl font-semibold text-neutral-950">
                {recentOrders.length}
              </p>
            </div>
          ) : null}
        </section>

        {canViewOrders ? (
          <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h3 className="text-lg font-medium text-neutral-950">
                  Revenue summary
                </h3>
                <p className="mt-1 text-sm text-neutral-500">
                  Paid orders since {formatDate(startOfMonth)}
                </p>
              </div>
              <Link
                className="text-sm font-medium text-neutral-700 hover:text-neutral-950"
                href="/dashboard/orders"
              >
                View orders
              </Link>
            </div>
            <div className="mt-6 grid h-40 grid-cols-4 items-end gap-3">
              {buckets.map((bucket) => (
                <div className="grid gap-2" key={bucket.label}>
                  <div
                    className="rounded-t-md bg-neutral-900"
                    style={{
                      height: `${Math.max(8, (bucket.total / maxBucket) * 128)}px`
                    }}
                  />
                  <div className="text-center text-xs text-neutral-500">
                    <p>{bucket.label}</p>
                    <p>{formatMoney(bucket.total)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="text-lg font-medium text-neutral-950">
                Upcoming events
              </h3>
              <Link
                className="text-sm font-medium text-neutral-700 hover:text-neutral-950"
                href="/dashboard/events"
              >
                View all
              </Link>
            </div>
            {upcomingEvents.length === 0 ? (
              <p className="text-sm text-neutral-600">No upcoming events.</p>
            ) : (
              <ul className="grid gap-3">
                {upcomingEvents.map((event) => (
                  <li
                    className="rounded-lg border border-neutral-200 p-3 text-sm"
                    key={event.id}
                  >
                    <p className="font-medium text-neutral-950">{event.title}</p>
                    <p className="mt-1 text-neutral-600">
                      {formatDate(event.startTime)} · {event.status}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {canViewOrders ? (
            <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="text-lg font-medium text-neutral-950">
                Recent orders
              </h3>
              <Link
                className="text-sm font-medium text-neutral-700 hover:text-neutral-950"
                href="/dashboard/orders"
              >
                View all
              </Link>
            </div>
            {recentOrders.length === 0 ? (
              <p className="text-sm text-neutral-600">No orders yet.</p>
            ) : (
              <ul className="grid gap-3">
                {recentOrders.map((order) => (
                  <li
                    className="rounded-lg border border-neutral-200 p-3 text-sm"
                    key={order.id}
                  >
                    <div className="flex justify-between gap-4">
                      <p className="font-medium text-neutral-950">
                        {order.event.title}
                      </p>
                      <p className="text-neutral-700">
                        {formatMoney(order.totalAmount)}
                      </p>
                    </div>
                    <p className="mt-1 text-neutral-600">
                      {order.quantity} ticket{order.quantity === 1 ? "" : "s"} ·{" "}
                      {order.status}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            </div>
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
