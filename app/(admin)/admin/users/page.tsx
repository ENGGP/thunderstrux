import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { AdminTime, Panel, rowLink, tableClass } from "@/components/admin/record";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePlatformPage } from "@/lib/platform/authority";
import { listNewestUsers } from "@/lib/platform/records";

export const metadata: Metadata = { title: "Admin users" };

const examples: Array<[string, string]> = [
  ["alex@uq.edu.au", "The user with exactly that email"],
  ["cm3k8x2p50001…", "Any record with that id: user, society, event, order"],
  ["cs_… · pi_…", "The order paid with that Checkout Session or PaymentIntent"],
  ["acct_… · po_…", "The society with that Stripe account or payout"],
  ["re_… · du_…", "The order with that refund or dispute"],
  ["7K2Q9D", "Ticket orders with that reference"],
  ["jordan", "Names starting with it, and societies by name or link"]
];

// T54 (board H1): search finds one person; nothing here lists everyone.
export default async function AdminUsersPage() {
  const actor = await requirePlatformPage("platform:read", "/admin/users");
  const newest = await listNewestUsers();
  return (
    <AdminShell actor={actor} current="users">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold">Users</h1>
        <p className="text-sm text-ink-soft">Search finds one person. Nothing here lists everyone.</p>
      </div>
      <form action="/admin/search" className="flex flex-wrap items-end gap-2.5 rounded-[10px] border border-line bg-surface px-4 py-3.5" method="get" role="search">
        <label className="flex flex-[1_1_420px] flex-col gap-1.5 font-semibold">
          Email, user id or name
          <input className="h-10 rounded-[8px] border border-line-strong bg-surface px-3 font-normal" name="q" placeholder="alex@uq.edu.au" type="search" />
        </label>
        <button className="min-h-10 rounded-[8px] bg-ink px-3.5 font-semibold text-white" type="submit">Search</button>
      </form>
      <Panel note="Each search is logged with a fingerprint, never what you typed" title="What you can paste, here or in the bar above">
        <dl className="grid grid-cols-[minmax(0,260px)_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-3.5 text-[13.5px]">
          {examples.map(([example, meaning]) => (
            <div className="contents" key={example}><dt className="font-mono text-[12.5px]">{example}</dt><dd className="m-0 text-ink-soft">{meaning}</dd></div>
          ))}
        </dl>
      </Panel>
      <Panel note="The 50 most recent; this list never pages further" title="Newest signups">
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">State</th><th scope="col">Signed up</th></tr></thead>
            <tbody>
              {newest.map((user) => (
                <tr key={user.id}>
                  <td><Link className={rowLink} href={`/admin/users/${user.id}`}>{user.displayName || [user.firstName, user.lastName].filter(Boolean).join(" ") || "No name"}</Link></td>
                  <td>{user.email}</td>
                  <td>{user.disabledAt ? <StatusBadge label="Disabled" status="failed" /> : user.emailVerifiedAt ? <StatusBadge label="Verified" status="ready" /> : <StatusBadge label="Unverified" status="pending" />}</td>
                  <td><AdminTime value={user.createdAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AdminShell>
  );
}
