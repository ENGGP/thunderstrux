import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { AdminTime, Panel, rowLink, tableClass } from "@/components/admin/record";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePlatformPage } from "@/lib/platform/authority";
import { listSocieties } from "@/lib/platform/records";

export const metadata: Metadata = { title: "Admin societies" };

// T54: societies are few, so they list (200 at most, by name).
export default async function AdminSocietiesPage() {
  const actor = await requirePlatformPage("platform:read", "/admin/societies");
  const societies = await listSocieties();
  return (
    <AdminShell actor={actor} current="societies">
      <h1 className="text-[22px] font-semibold">Societies</h1>
      <Panel note={societies.length >= 200 ? "The first 200 by name; search for the rest" : `${societies.length} in all`} title="Societies">
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead><tr><th scope="col">Society</th><th scope="col">Link</th><th scope="col">Payments</th><th className="text-right" scope="col">Staff</th><th className="text-right" scope="col">Events</th><th scope="col">Created</th></tr></thead>
            <tbody>
              {societies.map((society) => (
                <tr key={society.id}>
                  <td><Link className={rowLink} href={`/admin/societies/${society.id}`}>{society.name}</Link></td>
                  <td className="font-mono text-[12.5px]">{society.slug}</td>
                  <td>{society.stripeChargesEnabled && society.stripePayoutsEnabled ? <StatusBadge status="ready" /> : <StatusBadge label="Not set up" status="expired" />}</td>
                  <td className="text-right tabular-nums">{society._count.staff}</td>
                  <td className="text-right tabular-nums">{society._count.events}</td>
                  <td><AdminTime value={society.createdAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AdminShell>
  );
}
