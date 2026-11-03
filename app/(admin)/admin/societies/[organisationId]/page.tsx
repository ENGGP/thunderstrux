import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { IdChip } from "@/components/admin/id-chip";
import { RememberRecord } from "@/components/admin/omnibox";
import { ActivityList, AdminTime, AttentionStrip, Breadcrumbs, Facts, Panel, RecordHeader, rowLink, tableClass } from "@/components/admin/record";
import { LinkTabs } from "@/components/ui/link-tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/format";
import { recordPlatformView } from "@/lib/platform/audit";
import { requirePlatformPage } from "@/lib/platform/authority";
import { readSocietyRecord } from "@/lib/platform/records";

export const metadata: Metadata = { title: "Admin society" };

const roleLabels: Record<string, string> = { owner: "Owner", admin: "Admin", event_manager: "Event manager", finance_manager: "Finance manager", check_in_staff: "Check-in staff" };
const tabs = ["overview", "activity"] as const;
const stripeAccountLink = (account: string) => `https://dashboard.stripe.com/connect/accounts/${encodeURIComponent(account)}`;

// T54 (board H5): one society's staff, payments, events and History.
export default async function AdminSocietyPage({ params, searchParams }: { params: Promise<{ organisationId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { organisationId } = await params;
  const path = `/admin/societies/${encodeURIComponent(organisationId)}`;
  const actor = await requirePlatformPage("platform:read", path);
  const record = await readSocietyRecord(organisationId);
  if (!record) notFound();
  await recordPlatformView(actor, { type: "Organisation", id: organisationId, organisationId });
  const { society, history, support, attention } = record;
  const requested = (await searchParams).tab;
  const tab = tabs.find((name) => name === requested) ?? "overview";
  const owners = society.staff.filter((row) => row.role === "owner" && row.status === "active").length;
  const activeStaff = society.staff.filter((row) => row.status === "active").length;
  const zone = society.timeZone;
  return (
    <AdminShell actor={actor} current="societies">
      <RememberRecord href={path} kind="Society" label={society.name} />
      <Breadcrumbs items={[{ label: "Societies", href: "/admin/societies" }, { label: society.name }]} />
      <RecordHeader
        actions={society.stripeAccountId ? <a className="inline-flex min-h-[38px] items-center gap-2 rounded-[8px] border border-line-strong bg-surface px-3.5 font-semibold" href={stripeAccountLink(society.stripeAccountId)} rel="noreferrer" target="_blank">Open in Stripe</a> : null}
        badges={society.stripeChargesEnabled && society.stripePayoutsEnabled ? <StatusBadge label="Stripe ready" status="ready" /> : <StatusBadge label="Stripe not set up" status="expired" />}
        facts={[`${zone.split("/").pop()?.replace(/_/g, " ")} time`, <>Created <AdminTime key="c" value={society.createdAt} timeZone={zone} /></>, `${owners} ${owners === 1 ? "owner" : "owners"}, ${activeStaff} staff`, society.supportEmail || "No contact email"]}
        ids={<><IdChip label="society id" value={society.id} /><IdChip label="society link name" value={society.slug} /></>}
        title={society.name}
        type="Society"
      />
      <AttentionStrip items={attention} />
      <LinkTabs label="Record sections" tabs={[
        { href: path, label: "Overview", active: tab === "overview" },
        { href: `${path}?tab=activity`, label: "Activity", active: tab === "activity", count: support.length + history.length }
      ]} />
      {tab === "overview" ? (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] gap-[18px]">
            <Panel note="Live roles" title="Staff">
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Authenticator</th><th scope="col">Last sign-in</th></tr></thead>
                  <tbody>
                    {society.staff.map((row) => (
                      <tr key={row.user.id}>
                        <td><Link className={rowLink} href={`/admin/users/${row.user.id}`}>{row.user.displayName || [row.user.firstName, row.user.lastName].filter(Boolean).join(" ") || row.user.email}</Link></td>
                        <td>{roleLabels[row.role] ?? row.role}{row.status === "active" ? "" : " (revoked)"}</td>
                        <td>{row.role === "check_in_staff" ? <span className="text-ink-muted">not needed</span> : row.user.mfa?.enabledAt ? "On" : "Off"}</td>
                        <td><AdminTime value={row.user.lastSignInAt} timeZone={zone} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <Panel title="Stripe">
              <Facts rows={[
                ["Account", society.stripeAccountId ? <IdChip key="a" label="Stripe account id" value={society.stripeAccountId} /> : "Not connected"],
                ["Card payments", society.stripeChargesEnabled ? "On" : "Off"],
                ["Payouts", society.stripePayoutsEnabled ? "On" : "Off"],
                ["Details", society.stripeDetailsSubmitted ? "Submitted" : "Not submitted"],
                ["Cached status", society.stripeAccountStatus ?? "—"],
                ["Payout check", <AdminTime key="p" value={society.payoutCheckedAt} timeZone={zone} />]
              ]} />
            </Panel>
          </div>
          <Panel note="The 20 latest by start" title={`Events · ${society._count.events}`}>
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead><tr><th scope="col">Event</th><th scope="col">State</th><th scope="col">Starts</th><th scope="col">Id</th></tr></thead>
                <tbody>
                  {society.events.map((event) => (
                    <tr key={event.id}>
                      <td className="font-semibold">{event.title}</td>
                      <td>{event.cancelledAt ? <StatusBadge status="event-cancelled" /> : <StatusBadge status={event.status === "published" ? (event.saleState === "open" ? "sales-open" : "sales-closed") : "draft"} />}</td>
                      <td><AdminTime value={event.startTime} timeZone={zone} /></td>
                      <td className="font-mono text-[12.5px]">{event.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] gap-[18px]">
            <Panel title="Payouts">
              {society.payouts.length === 0 ? <p className="px-4 py-3.5 text-ink-muted">No payouts yet.</p> : (
                <div className="overflow-x-auto">
                  <table className={tableClass}>
                    <thead><tr><th scope="col">Payout</th><th scope="col">Date</th><th className="text-right" scope="col">Amount</th><th scope="col">Status</th></tr></thead>
                    <tbody>
                      {society.payouts.map((payout) => (
                        <tr key={payout.stripePayoutId}>
                          <td className="font-mono text-[12.5px]">{payout.stripePayoutId}</td>
                          <td><AdminTime value={payout.createdAt} timeZone={zone} /></td>
                          <td className="text-right tabular-nums">{formatMoney(payout.amount)}</td>
                          <td><StatusBadge status={payout.status === "paid" ? "paid" : payout.status === "failed" ? "failed" : "pending"} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            <Panel note="As the society sees it; never your name" title="Its History">
              <ul>
                {history.length === 0 ? <li className="px-4 py-3.5 text-ink-muted">Nothing yet.</li> : history.map((entry) => (
                  <li className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-[#efedf3] px-4 py-2.5 first:border-t-0" key={entry.id}>
                    <span><strong>{entry.actor.name}</strong>{entry.actor.role ? <span className="text-ink-muted"> {entry.actor.role}</span> : null} {entry.sentence.map((part) => (typeof part === "string" ? part : part.text)).join("")}</span>
                    <span className="text-[12.5px] text-ink-muted"><AdminTime value={entry.at} timeZone={zone} /></span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </>
      ) : (
        <Panel note="Support changes about this society" title="Activity">
          <ActivityList empty="No support changes yet. The society's own History is on Overview." rows={support} timeZone={zone} />
        </Panel>
      )}
    </AdminShell>
  );
}
