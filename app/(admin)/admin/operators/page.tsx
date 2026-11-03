import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { AdminTime, Panel, rowLink, tableClass } from "@/components/admin/record";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePlatformPage } from "@/lib/platform/authority";
import { listPlatformOperators } from "@/lib/platform/operators";

export const metadata: Metadata = { title: "Admin operators" };

// T54: who can use this portal. Granting is CLI only (Q7); revoking from here arrives with T55.
export default async function AdminOperatorsPage() {
  const actor = await requirePlatformPage("platform:operators", "/admin/operators");
  const operators = await listPlatformOperators();
  return (
    <AdminShell actor={actor} current="operators">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold">Operators</h1>
        <p className="text-sm text-ink-soft">
          Granted only from the host: <code className="font-mono text-[12.5px]">pnpm ops:operator -- grant &lt;email&gt; --role=support|admin --note=&quot;…&quot;</code>
        </p>
      </div>
      <Panel title={`Operators · ${operators.length}`}>
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead><tr><th scope="col">Account</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Authenticator</th><th scope="col">Last sign-in</th><th scope="col">Granted</th><th scope="col">By</th></tr></thead>
            <tbody>
              {operators.map((row) => (
                <tr key={row.id}>
                  <td><Link className={rowLink} href={`/admin/users/${row.user.id}`}>{row.user.email}</Link></td>
                  <td>{row.role}</td>
                  <td><StatusBadge status={row.status === "active" ? "staff-active" : "revoked"} /></td>
                  <td>{row.user.mfa?.enabledAt ? "On" : "Not set up"}</td>
                  <td><AdminTime value={row.user.lastSignInAt} /></td>
                  <td><AdminTime value={row.grantedAt} /></td>
                  <td className="font-mono text-[12.5px]">{row.grantedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AdminShell>
  );
}
