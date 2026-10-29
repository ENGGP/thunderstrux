import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkTabs } from "@/components/ui/link-tabs";
import { Pager } from "@/components/ui/pager";
import { ListSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireManagementPage } from "@/lib/auth/page-access";
import { formatPrice, joinDays } from "@/lib/format";
import { hasOrganisationPermission } from "@/lib/permissions";
import { formatDay, listPlans, type StaffPlan } from "@/lib/memberships/plans";
import { zoneCity } from "@/lib/zoned-time";

export const metadata: Metadata = { title: "Memberships" };

const unlockWords = { member_prices: "Member prices", members_only_events: "Members-only events" } as const;

type Page = { cursor?: string; direction?: string };

export default async function MembershipsPage({ searchParams }: { searchParams: Promise<Page> }) {
  const page = await searchParams;
  const organisation = await requireManagementPage("memberships:manage", "/dashboard/memberships");
  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader
        actions={
          <Link className={buttonClasses({ variant: "secondary" })} href="/dashboard/memberships/new">
            New plan
          </Link>
        }
        description="Fixed-term memberships. Buyers get member prices and members-only events for the dates you set."
        title="Memberships"
      />
      {hasOrganisationPermission(organisation.staffRole, "members:read") ? (
        <LinkTabs
          label="Membership sections"
          tabs={[
            { href: "/dashboard/memberships", label: "Plans", active: true },
            { href: "/dashboard/memberships/members", label: "Members", active: false }
          ]}
        />
      ) : null}
      <Suspense fallback={<ListSkeleton label="Loading membership plans" />}>
        <Plans organisationId={organisation.id} page={page} />
      </Suspense>
    </DashboardShell>
  );
}

type Row = StaffPlan & { holders: number };

// Where the plan's term stands, in words.
function standingText(plan: Row, now: Date) {
  if (plan.standing === "draft" || plan.standing === "archived") return "Not on sale";
  if (plan.standing === "ended") return "Term ended";
  return new Date(plan.startsAt) > now ? `On sale · starts ${formatDay(plan.firstDay)}` : "On sale · running now";
}

function holdersText(plan: Row, now: Date) {
  if (plan.holders === 0) return "None yet";
  const word = new Date(plan.endsAt) <= now ? "expired" : new Date(plan.startsAt) > now ? "upcoming" : "active";
  return `${plan.holders} ${word}`;
}

async function Plans({ organisationId, page }: { organisationId: string; page: Page }) {
  const { plans, timeZone, nextCursor, previousCursor } = await listPlans(organisationId, new Date(), { cursor: page.cursor, direction: page.direction === "prev" ? "prev" : "next" });
  const pageHref = (cursor: string, direction: "next" | "prev") => `/dashboard/memberships?${new URLSearchParams({ cursor, direction })}`;
  const now = new Date();
  if (!plans.length) {
    return (
      <EmptyState
        action={
          <Link className={buttonClasses()} href="/dashboard/memberships/new">
            New plan
          </Link>
        }
        icon="badge"
        title="No membership plans yet"
      >
        Sell a membership for a semester or a year. Members get member prices and members-only events.
      </EmptyState>
    );
  }
  const titleLink = "font-semibold text-ink underline-offset-4 hover:underline [overflow-wrap:anywhere]";
  const runs = (plan: Row) => joinDays(formatDay(plan.firstDay), formatDay(plan.lastDay));
  const unlocks = (plan: Row) => plan.entitlements.map((key) => unlockWords[key]).join(", ") || "No unlocks";
  const action = (plan: Row) => (
    <Link
      aria-label={`${plan.status === "draft" ? "Edit" : "Details for"} ${plan.name}`}
      className={buttonClasses({ variant: "secondary", size: "sm" })}
      href={`/dashboard/memberships/${plan.id}`}
    >
      {plan.status === "draft" ? "Edit" : "Details"}
    </Link>
  );

  return (
    <>
      <div className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
        <table className="w-full min-w-[760px] border-collapse text-left text-ui">
          <thead>
            <tr className="text-caption text-ink-soft">
              <th className="px-5 py-3.5 font-semibold" scope="col">Plan</th>
              <th className="px-3 py-3.5 font-semibold" scope="col">Runs ({zoneCity(timeZone)})</th>
              <th className="px-3 py-3.5 font-semibold" scope="col">Price</th>
              <th className="px-3 py-3.5 font-semibold" scope="col">Status</th>
              <th className="px-3 py-3.5 font-semibold" scope="col">Members</th>
              <th className="px-5 py-3.5 text-right font-semibold" scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr className="border-t border-line align-top" key={plan.id}>
                <td className="px-5 py-4">
                  <Link className={titleLink} href={`/dashboard/memberships/${plan.id}`}>
                    {plan.name}
                  </Link>
                  <p className="text-sm text-ink-soft">{unlocks(plan)}</p>
                </td>
                <td className="px-3 py-4">
                  {runs(plan)}
                  <p className="text-sm text-ink-soft">{standingText(plan, now)}</p>
                </td>
                <td className="whitespace-nowrap px-3 py-4 tabular-nums">{formatPrice(plan.priceAmount)}</td>
                <td className="px-3 py-4">
                  <StatusBadge status={plan.standing} />
                </td>
                <td className="whitespace-nowrap px-3 py-4 tabular-nums">{holdersText(plan, now)}</td>
                <td className="px-5 py-4">
                  <div className="flex justify-end">{action(plan)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="grid gap-4 md:hidden">
        {plans.map((plan) => (
          <li className="grid gap-2 rounded-card border border-line bg-surface p-5" key={plan.id}>
            <div className="flex items-start justify-between gap-3">
              <Link className={titleLink} href={`/dashboard/memberships/${plan.id}`}>
                {plan.name}
              </Link>
              <StatusBadge status={plan.standing} />
            </div>
            <p>{runs(plan)}</p>
            <p className="text-sm text-ink-soft">
              {formatPrice(plan.priceAmount)} · {standingText(plan, now)} · {holdersText(plan, now)}
            </p>
            <div>{action(plan)}</div>
          </li>
        ))}
      </ul>
      <Pager label="Plan pages" next={nextCursor && pageHref(nextCursor, "next")} previous={previousCursor && pageHref(previousCursor, "prev")} />

      <p className="text-sm text-ink-soft">
        Once someone has a plan, its name, dates, price and unlocks can&apos;t change. For next year, create a new plan. Plans are archived, never deleted.
      </p>
    </>
  );
}
