import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireManagementPage } from "@/lib/auth/page-access";
import { formatDate, formatDateTime } from "@/lib/format";
import { readMembership } from "@/lib/memberships/roster";
import { readTimeZone } from "@/lib/organisations/profile";
import { orderReference } from "@/lib/payments/order-refunds";
import { zoneCity } from "@/lib/zoned-time";

export const metadata: Metadata = { title: "Member" };

const unlockWords = { member_prices: "Member prices", members_only_events: "Members-only events" } as const;

export default async function MemberPage({ params }: { params: Promise<{ grantId: string }> }) {
  const { grantId } = await params;
  const organisation = await requireManagementPage("members:read", `/dashboard/memberships/members/${encodeURIComponent(grantId)}`);
  const membership = await readMembership(organisation.id, grantId);
  if (!membership) notFound();
  const timeZone = await readTimeZone(organisation.id);
  const lastDay = (endsAt: Date) => formatDate(new Date(endsAt.getTime() - 1), timeZone);
  const row = "grid gap-x-6 gap-y-2.5 text-[15px] sm:grid-cols-[max-content_1fr]";

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader
        badge={<StatusBadge status={membership.state} />}
        breadcrumbs={[
          { label: "Memberships", href: "/dashboard/memberships" },
          { label: "Members", href: "/dashboard/memberships/members" }
        ]}
        title={membership.name}
      />
      {membership.revokedAt ? (
        <Notice title="Ended early" tone="info">
          <p className="mt-0.5">
            Revoked on {formatDate(membership.revokedAt, timeZone)}
            {membership.revokedBy ? ` by ${membership.revokedBy}` : ""}: “{membership.revocationReason}”
          </p>
        </Notice>
      ) : null}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <div className="grid gap-4">
            <h2 className="font-display text-xl font-semibold text-ink">Membership</h2>
            <dl className={row}>
              <dt className="text-ink-soft">Plan</dt>
              <dd className="[overflow-wrap:anywhere]">{membership.plan.name}</dd>
              <dt className="text-ink-soft">Runs</dt>
              <dd>
                {formatDate(membership.startsAt, timeZone)} to {lastDay(membership.endsAt)}, {zoneCity(timeZone)}
              </dd>
              <dt className="text-ink-soft">Unlocks</dt>
              <dd>{membership.entitlements.map((key) => unlockWords[key]).join(", ") || "Nothing"}</dd>
              <dt className="text-ink-soft">From</dt>
              <dd>
                {membership.paid ? "Paid" : "Free"} · Order {orderReference(membership.orderId)}
              </dd>
              <dt className="text-ink-soft">Granted</dt>
              <dd>{formatDateTime(membership.grantedAt, { timeZone })}</dd>
              <dt className="text-ink-soft">Email</dt>
              <dd className="[overflow-wrap:anywhere]">{membership.email}</dd>
            </dl>
          </div>
        </Card>
        <Card>
          <div className="grid gap-4">
            <h2 className="font-display text-xl font-semibold text-ink">With the society</h2>
            <dl className={row}>
              <dt className="text-ink-soft">Joined</dt>
              <dd>{membership.joinedAt ? `Joined free on ${formatDate(membership.joinedAt, timeZone)}` : "Not joined"}</dd>
              <dt className="text-ink-soft">Other terms</dt>
              <dd>
                {membership.others.length ? (
                  <ul className="grid gap-1">
                    {membership.others.map((other) => (
                      <li className="flex flex-wrap items-center gap-2" key={other.id}>
                        <span className="[overflow-wrap:anywhere]">{other.plan}</span>
                        <StatusBadge status={other.state} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  "None"
                )}
              </dd>
              <dt className="text-ink-soft">Staff</dt>
              <dd>{membership.staff ? "Yes" : "No"}</dd>
            </dl>
            <p className="text-sm text-ink-soft">Joining, membership and staff access are separate. Each changes on its own.</p>
          </div>
        </Card>
      </div>
    </DashboardShell>
  );
}
