import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { IdChip } from "@/components/admin/id-chip";
import { RememberRecord } from "@/components/admin/omnibox";
import { ActivityList, AdminTime, AttentionStrip, Breadcrumbs, Facts, Panel, RecordHeader, rowLink, tableClass } from "@/components/admin/record";
import { LinkTabs } from "@/components/ui/link-tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { recordPlatformView } from "@/lib/platform/audit";
import { requirePlatformPage } from "@/lib/platform/authority";
import { readUserRecord } from "@/lib/platform/records";

export const metadata: Metadata = { title: "Admin user" };

const roleLabels: Record<string, string> = { owner: "Owner", admin: "Admin", event_manager: "Event manager", finance_manager: "Finance manager", check_in_staff: "Check-in staff" };
const tabs = ["overview", "activity", "raw"] as const;

// T54 (board H4): one person's account, roles, purchases and security, with
// every view logged. Changes (Actions) arrive in T55.
export default async function AdminUserPage({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { userId } = await params;
  const path = `/admin/users/${encodeURIComponent(userId)}`;
  const actor = await requirePlatformPage("platform:read", path);
  const record = await readUserRecord(userId);
  if (!record) notFound();
  await recordPlatformView(actor, { type: "User", id: userId });
  const { user, activity, attention } = record;
  const requested = (await searchParams).tab;
  const tab = tabs.find((name) => name === requested) ?? "overview";
  const name = user.displayName || [user.firstName, user.lastName].filter(Boolean).join(" ") || "No name";
  const activeStaff = user.organisationStaff.filter((row) => row.status === "active").length;
  return (
    <AdminShell actor={actor} current="users">
      <RememberRecord href={path} kind="User" label={user.firstName || user.displayName ? name : `User …${user.id.slice(-6)}`} />
      <Breadcrumbs items={[{ label: "Users", href: "/admin/users" }, { label: name }]} />
      <RecordHeader
        badges={<>
          {user.closedAt ? <StatusBadge label="Closed" status="revoked" /> : user.disabledAt ? <StatusBadge label="Disabled" status="failed" /> : null}
          {user.emailVerifiedAt ? <StatusBadge label="Verified" status="ready" /> : <StatusBadge label="Unverified" status="pending" />}
          {user.mfa?.enabledAt ? <StatusBadge label="Authenticator on" status="ready" /> : null}
          {activeStaff ? <StatusBadge label={`Staff in ${activeStaff} ${activeStaff === 1 ? "society" : "societies"}`} status="joined" /> : null}
          {user.platformOperator?.status === "active" ? <StatusBadge label={`Operator · ${user.platformOperator.role}`} status="upcoming" /> : null}
        </>}
        facts={[user.email, user.accountRole === "organisation" ? "Society login" : "Member account", <>Signed up <AdminTime key="c" value={user.createdAt} /></>, <>Last sign-in <AdminTime key="s" value={user.lastSignInAt} /></>]}
        ids={<IdChip label="user id" value={user.id} />}
        title={name}
        type="User"
      />
      <AttentionStrip items={attention} />
      <LinkTabs label="Record sections" tabs={[
        { href: path, label: "Overview", active: tab === "overview" },
        { href: `${path}?tab=activity`, label: "Activity", active: tab === "activity", count: activity.length },
        { href: `${path}?tab=raw`, label: "Raw", active: tab === "raw" }
      ]} />
      {tab === "overview" ? (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] gap-[18px]">
            <Panel title="Account">
              <Facts rows={[
                ["Email", <>{user.email} {user.emailVerifiedAt ? <span className="text-ink-muted">verified <AdminTime value={user.emailVerifiedAt} /></span> : null}</>],
                ["Kind", user.accountRole === "organisation" ? "Society login" : "Member"],
                ["Created", <AdminTime key="c" value={user.createdAt} />],
                ["Last sign-in", <AdminTime key="s" value={user.lastSignInAt} />],
                ["Session version", <span className="font-mono" key="v">{user.authVersion}</span>],
                ["Operator", user.platformOperator ? `${user.platformOperator.role}, ${user.platformOperator.status}` : "No"]
              ]} />
            </Panel>
            <Panel note="Private to the person; never in society History" title="Security">
              <Facts rows={[
                ["Authenticator", user.mfa?.enabledAt ? <>On since <AdminTime value={user.mfa.enabledAt} /></> : "Not set up"],
                ["Recovery codes", user.mfa?.enabledAt ? `${user._count.mfaRecoveryCodes} of 10 left` : "—"],
                ["Disabled", <AdminTime key="d" value={user.disabledAt} />],
                ["Closed", <AdminTime key="x" value={user.closedAt} />]
              ]} />
            </Panel>
          </div>
          <Panel note="Live rows; a revoked role grants nothing" title="Staff roles">
            {user.organisationStaff.length === 0 ? <p className="px-4 py-3.5 text-ink-muted">No society roles.</p> : (
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead><tr><th scope="col">Society</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Since</th></tr></thead>
                  <tbody>
                    {user.organisationStaff.map((row) => (
                      <tr key={row.organisation.id}>
                        <td><Link className={rowLink} href={`/admin/societies/${row.organisation.id}`}>{row.organisation.name}</Link></td>
                        <td>{roleLabels[row.role] ?? row.role}</td>
                        <td><StatusBadge status={row.status === "active" ? "staff-active" : "revoked"} /></td>
                        <td><AdminTime value={row.createdAt} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <Panel title="As a buyer">
            <Facts rows={[
              ["Ticket orders", String(user._count.orders)],
              ["Membership and shop orders", String(user._count.commerceOrders)],
              ["Joined societies", `${user._count.organisationMemberships} (no authority)`]
            ]} />
          </Panel>
        </>
      ) : null}
      {tab === "activity" ? (
        <Panel note="Support changes, society History and account security, newest first" title="Activity">
          <ActivityList rows={activity} />
        </Panel>
      ) : null}
      {tab === "raw" ? (
        <Panel note="Allow-listed fields. Never the password hash, authenticator secret, recovery codes or token digests." title="Raw">
          <Facts rows={(["id", "email", "emailVerifiedAt", "accountRole", "authVersion", "disabledAt", "closedAt", "lastSignInAt", "createdAt"] as const)
            .map((field) => [field, <span className="font-mono text-[12.5px]" key={field}>{user[field] instanceof Date ? (user[field] as Date).toISOString() : String(user[field] ?? "null")}</span>])} />
        </Panel>
      ) : null}
    </AdminShell>
  );
}
