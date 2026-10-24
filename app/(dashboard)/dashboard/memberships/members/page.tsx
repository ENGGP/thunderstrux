import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TextInput } from "@/components/ui/input";
import { Count, LinkTabs, pillClasses } from "@/components/ui/link-tabs";
import { ListSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireManagementPage } from "@/lib/auth/page-access";
import { formatDate, formatTerm } from "@/lib/format";
import { listFreeJoins, listRoster, rosterViews, type RosterView } from "@/lib/memberships/roster";
import { readTimeZone } from "@/lib/organisations/profile";
import { orderReference } from "@/lib/payments/order-refunds";
import { hasOrganisationPermission } from "@/lib/permissions";

export const metadata: Metadata = { title: "Members" };

type View = RosterView | "joins";
const viewLabels: Record<View, string> = { active: "Active", upcoming: "Upcoming", expired: "Expired", revoked: "Revoked", joins: "Free joins" };
const emptyText: Record<View, string> = {
  active: "Nobody has a membership running now.",
  upcoming: "When someone buys a plan that hasn't started, they appear here.",
  expired: "Memberships appear here after their last day.",
  revoked: "No membership has been ended early.",
  joins: "Nobody has joined the society for free yet."
};

function href(view: View, query: string, cursor?: string) {
  const params = new URLSearchParams();
  if (view !== "active") params.set("view", view);
  if (query) params.set("q", query);
  if (cursor) params.set("cursor", cursor);
  const search = params.toString();
  return search ? `/dashboard/memberships/members?${search}` : "/dashboard/memberships/members";
}

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; cursor?: string }> }) {
  const organisation = await requireManagementPage("members:read", "/dashboard/memberships/members");
  const params = await searchParams;
  const view = ([...rosterViews, "joins"] as View[]).find((name) => name === params.view) ?? "active";
  const query = params.q?.trim().slice(0, 100) ?? "";
  const cursor = params.cursor?.slice(0, 500) || undefined;

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader title="Memberships" />
      {hasOrganisationPermission(organisation.staffRole, "memberships:manage") ? (
        <LinkTabs
          label="Membership sections"
          tabs={[
            { href: "/dashboard/memberships", label: "Plans", active: false },
            { href: "/dashboard/memberships/members", label: "Members", active: true }
          ]}
        />
      ) : null}
      <Suspense fallback={<ListSkeleton label="Loading members" />}>
        <Roster cursor={cursor} organisationId={organisation.id} query={query} view={view} />
      </Suspense>
      <section aria-labelledby="lists-heading" className="grid gap-1.5 rounded-card border border-line bg-surface-subtle p-5">
        <h2 className="font-semibold text-ink" id="lists-heading">
          Members, joins and staff are different lists
        </h2>
        <p className="text-sm text-ink-soft">
          A member bought or was given a membership with dates. A free join only follows the society: it gives no member prices. Neither one is staff
          access. Leaving the society doesn&apos;t end a membership.
        </p>
      </section>
    </DashboardShell>
  );
}

async function Roster({ organisationId, view, query, cursor }: { organisationId: string; view: View; query: string; cursor?: string }) {
  const timeZone = await readTimeZone(organisationId);
  const roster = await listRoster(organisationId, { view: view === "joins" ? "active" : view, query, cursor: view === "joins" ? undefined : cursor });
  const joins = view === "joins" ? await listFreeJoins(organisationId, { query, cursor }) : null;
  const nextCursor = joins ? joins.nextCursor : roster.nextCursor;
  const rows = joins ? joins.joins.length : roster.members.length;
  const runs = (startsAt: Date, endsAt: Date) => formatTerm(startsAt, endsAt, timeZone);
  const nameLink = "font-semibold text-ink underline-offset-4 hover:underline [overflow-wrap:anywhere]";

  return (
    <>
      <nav aria-label="Member views" className="flex flex-wrap items-center gap-2">
        {([...rosterViews, "joins"] as View[]).map((name) => (
          <Link
            aria-current={name === view ? "page" : undefined}
            className={`${pillClasses(name === view)} ${name === "joins" ? "sm:ml-3" : ""}`}
            href={href(name, query)}
            key={name}
          >
            {viewLabels[name]} <Count active={name === view} value={roster.counts[name]} />
          </Link>
        ))}
      </nav>
      <Form action="/dashboard/memberships/members" className="flex w-full items-end gap-2 sm:max-w-md" role="search">
        {view !== "active" ? <input name="view" type="hidden" value={view} /> : null}
        <div className="flex-1">
          <TextInput defaultValue={query} label="Search members" name="q" placeholder="Name or email" type="search" />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </Form>

      {rows === 0 ? (
        <EmptyState icon={query ? "search" : "users"} title={query ? `No ${viewLabels[view].toLowerCase()} match “${query}”` : `No ${viewLabels[view].toLowerCase()} ${view === "joins" ? "" : "members"}`.trim()}>
          {query ? "Check the spelling or clear the search." : emptyText[view]}
        </EmptyState>
      ) : joins ? (
        <ul className="grid divide-y divide-line rounded-card border border-line bg-surface">
          {joins.joins.map((join) => (
            <li className="grid gap-1 px-5 py-4 sm:flex sm:items-center sm:justify-between" key={join.id}>
              <span>
                <span className="font-semibold text-ink [overflow-wrap:anywhere]">{join.name}</span>
                <span className="block text-sm text-ink-soft [overflow-wrap:anywhere]">{join.email}</span>
              </span>
              <span className="text-sm text-ink-soft">
                Joined {formatDate(join.joinedAt, timeZone)}
                {join.member ? " · also a member" : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
            <table className="w-full min-w-[760px] border-collapse text-left text-ui">
              <thead>
                <tr className="text-caption text-ink-soft">
                  <th className="px-5 py-3.5 font-semibold" scope="col">Member</th>
                  <th className="px-3 py-3.5 font-semibold" scope="col">Plan</th>
                  <th className="px-3 py-3.5 font-semibold" scope="col">Runs</th>
                  <th className="px-3 py-3.5 font-semibold" scope="col">State</th>
                  <th className="px-5 py-3.5 font-semibold" scope="col">From</th>
                </tr>
              </thead>
              <tbody>
                {roster.members.map((member) => (
                  <tr className="border-t border-line align-top" key={member.id}>
                    <td className="px-5 py-4">
                      <Link className={nameLink} href={`/dashboard/memberships/members/${member.id}`}>
                        {member.name}
                      </Link>
                      <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{member.email}</p>
                    </td>
                    <td className="px-3 py-4 [overflow-wrap:anywhere]">{member.plan}</td>
                    <td className="px-3 py-4">{runs(member.startsAt, member.endsAt)}</td>
                    <td className="px-3 py-4">
                      <StatusBadge status={member.state} />
                    </td>
                    <td className="whitespace-nowrap px-5 py-4">
                      {member.paid ? "Paid" : "Free"} · Order {orderReference(member.orderId)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="grid divide-y divide-line rounded-card border border-line bg-surface md:hidden">
            {roster.members.map((member) => (
              <li className="grid gap-1 px-4 py-3.5" key={member.id}>
                <Link className={nameLink} href={`/dashboard/memberships/members/${member.id}`}>
                  {member.name}
                </Link>
                <span className="text-sm text-ink-soft [overflow-wrap:anywhere]">{member.plan}</span>
                <span className="text-sm text-ink-soft">{runs(member.startsAt, member.endsAt)}</span>
                <StatusBadge status={member.state} />
              </li>
            ))}
          </ul>
        </>
      )}
      {nextCursor ? (
        <Link className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4" href={href(view, query, nextCursor)}>
          Next page
        </Link>
      ) : null}
    </>
  );
}
