import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { MemberProfileForm } from "@/components/members/member-profile-form";
import {
  OrganisationAccessError,
  getMemberOrganisations,
  requireAuthenticatedUser,
  requireCurrentOrganisationAccount
} from "@/lib/auth/access";
import { prisma } from "@/lib/db";
import { failStalePreCheckoutOrders } from "@/lib/orders/stale-orders";

function formatCurrency(amountInCents: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "AUD"
  }).format(amountInCents / 100);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium"
  }).format(value);
}

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

async function OrganisationDashboard() {
  const organisation = await requireCurrentOrganisationAccount();
  const startOfMonth = monthStart();

  await failStalePreCheckoutOrders({ organisationId: organisation.id });

  const [upcomingEvents, recentOrders, monthlyPaidOrders] = await Promise.all([
    prisma.event.findMany({
      where: {
        organisationId: organisation.id,
        startTime: {
          gte: new Date()
        }
      },
      orderBy: { startTime: "asc" },
      take: 5,
      select: {
        id: true,
        title: true,
        startTime: true,
        status: true
      }
    }),
    prisma.order.findMany({
      where: { organisationId: organisation.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        status: true,
        quantity: true,
        totalAmount: true,
        createdAt: true,
        paidAt: true,
        event: {
          select: {
            title: true
          }
        }
      }
    }),
    prisma.order.findMany({
      where: {
        organisationId: organisation.id,
        status: "paid",
        paidAt: {
          gte: startOfMonth
        }
      },
      select: {
        totalAmount: true,
        paidAt: true
      }
    })
  ]);

  const monthlyRevenue = monthlyPaidOrders.reduce(
    (total, order) => total + order.totalAmount,
    0
  );
  const buckets = revenueBuckets(monthlyPaidOrders);
  const maxBucket = Math.max(...buckets.map((bucket) => bucket.total), 1);

  return (
    <DashboardShell basePath="/dashboard" orgName={organisation.name}>
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-sm text-neutral-500">Organisation dashboard</p>
              <h2 className="mt-2 text-3xl font-semibold text-neutral-950">
                {organisation.name}
              </h2>
            </div>
            <Link
              className="inline-flex items-center justify-center rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700"
              href="/dashboard/events/new"
            >
              New event
            </Link>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-neutral-500">Past month revenue</p>
            <p className="mt-2 text-2xl font-semibold text-neutral-950">
              {formatCurrency(monthlyRevenue)}
            </p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-neutral-500">Upcoming events</p>
            <p className="mt-2 text-2xl font-semibold text-neutral-950">
              {upcomingEvents.length}
            </p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-neutral-500">Recent orders</p>
            <p className="mt-2 text-2xl font-semibold text-neutral-950">
              {recentOrders.length}
            </p>
          </div>
        </section>

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
                  <p>{formatCurrency(bucket.total)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

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
                        {formatCurrency(order.totalAmount)}
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
        </section>
      </div>
    </DashboardShell>
  );
}

async function MemberDashboard({ userId }: { userId: string }) {
  await failStalePreCheckoutOrders({ userId });

  const [user, organisations, orderCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        lastName: true,
        displayName: true,
        phone: true,
        studentNumber: true,
        onboardingCompletedAt: true
      }
    }),
    getMemberOrganisations(),
    prisma.order.count({
      where: { userId }
    })
  ]);

  return (
    <main className="min-h-screen bg-neutral-100">
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <header className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-semibold text-neutral-950">Dashboard</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Manage your profile, organisations, events, and tickets.
          </p>
        </header>

        {!user?.onboardingCompletedAt ? (
          <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-medium text-neutral-950">
              Complete your profile
            </h2>
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
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-3">
          <Link
            className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-neutral-300"
            href="/dashboard/organisations"
          >
            <p className="text-sm text-neutral-500">Joined organisations</p>
            <p className="mt-2 text-2xl font-semibold text-neutral-950">
              {organisations.length}
            </p>
          </Link>
          <Link
            className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-neutral-300"
            href="/"
          >
            <p className="text-sm text-neutral-500">Published events</p>
            <p className="mt-2 text-2xl font-semibold text-neutral-950">Browse</p>
          </Link>
          <Link
            className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-neutral-300"
            href="/tickets"
          >
            <p className="text-sm text-neutral-500">Orders</p>
            <p className="mt-2 text-2xl font-semibold text-neutral-950">
              {orderCount}
            </p>
          </Link>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-medium text-neutral-950">
                Your organisations
              </h2>
              <p className="mt-1 text-sm text-neutral-500">
                Search and join organisations to follow their activity.
              </p>
            </div>
            <Link
              className="inline-flex items-center justify-center rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700"
              href="/dashboard/organisations"
            >
              Search organisations
            </Link>
          </div>

          {organisations.length === 0 ? (
            <p className="mt-5 text-sm text-neutral-600">
              You have not joined any organisations yet.
            </p>
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {organisations.map((organisation) => (
                <article
                  className="rounded-lg border border-neutral-200 p-4"
                  key={organisation.id}
                >
                  <h3 className="font-medium text-neutral-950">
                    {organisation.name}
                  </h3>
                  <p className="mt-1 text-sm text-neutral-500">
                    Joined as {organisation.role}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default async function DashboardPage() {
  const user = await requireAuthenticatedUser();

  if (user.accountRole === "organisation") {
    try {
      return await OrganisationDashboard();
    } catch (error) {
      if (error instanceof OrganisationAccessError) {
        redirect("/dashboard/create");
      }

      throw error;
    }
  }

  return <MemberDashboard userId={user.id} />;
}
