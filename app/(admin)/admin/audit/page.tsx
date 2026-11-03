import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { AdminTime, Panel, rowLink } from "@/components/admin/record";
import { FilterBar } from "@/components/ui/filter-bar";
import { Pager } from "@/components/ui/pager";
import { SelectControl } from "@/components/ui/select";
import { readPlatformAudit } from "@/lib/platform/audit";
import { requirePlatformPage } from "@/lib/platform/authority";

export const metadata: Metadata = { title: "Admin audit" };

const actions = [
  "platform.viewed", "platform.searched", "platform.mfa_verified", "platform.mfa_recovery_used", "platform.mfa_enabled",
  "platform.mfa_recovery_codes_replaced", "platform.operator_granted", "platform.operator_role_changed", "platform.operator_revoked"
];
const targetHref = (type: string, id: string | null) =>
  !id ? null : type === "User" ? `/admin/users/${id}` : type === "Organisation" ? `/admin/societies/${id}` : type === "Order" || type === "CommerceOrder" ? `/admin/orders/${id}` : null;

const decodeCursor = (value: string | undefined) => {
  const [at, id] = (value ?? "").split("_");
  const createdAt = new Date(at ?? "");
  return id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : undefined;
};

// T54: the platform trail, newest first, 50 a page; every filter is in the URL.
export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<{ action?: string; target?: string; cursor?: string }> }) {
  const actor = await requirePlatformPage("platform:audit_read", "/admin/audit");
  const params = await searchParams;
  const action = actions.includes(params.action ?? "") ? params.action : undefined;
  const targetId = params.target?.trim().slice(0, 64) || undefined;
  const { rows, next } = await readPlatformAudit({ action, targetId }, decodeCursor(params.cursor));
  const query = (cursor?: string) => {
    const search = new URLSearchParams({ ...(action ? { action } : {}), ...(targetId ? { target: targetId } : {}), ...(cursor ? { cursor } : {}) });
    return `/admin/audit${search.size ? `?${search}` : ""}`;
  };
  return (
    <AdminShell actor={actor} current="audit">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold">Audit</h1>
        <p className="text-sm text-ink-soft">What operators read and changed. Rows can't be edited; views and searches go after two years.</p>
      </div>
      <FilterBar action="/admin/audit" active={(action ? 1 : 0) + (targetId ? 1 : 0)} className="rounded-[10px] border border-line bg-surface px-4 py-3.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" label="Filter the audit trail">
        <div className="flex flex-col gap-1.5 text-sm font-semibold"><span id="audit-action">Action</span>
          <SelectControl aria-labelledby="audit-action" className="h-10 w-full rounded-[8px] border border-line-strong bg-surface px-2 font-normal" defaultValue={action ?? ""} name="action">
            <option value="">Any</option>
            {actions.map((name) => <option key={name} value={name}>{name}</option>)}
          </SelectControl>
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">Target id
          <input className="h-10 rounded-[8px] border border-line-strong bg-surface px-3 font-mono font-normal" defaultValue={targetId} name="target" type="search" />
        </label>
      </FilterBar>
      <Panel title="Entries">
        {rows.length === 0 ? <p className="px-4 py-3.5 text-ink-muted">No entries match.</p> : (
          <ul>
            {rows.map((row) => {
              const href = targetHref(row.targetType, row.targetId);
              return (
                <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-t border-[#efedf3] px-4 py-2.5 first:border-t-0" key={row.id}>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span><strong>{row.actor?.email ?? "CLI"}</strong> <span className="font-mono text-[12.5px]">{row.action}</span> {href ? <Link className={rowLink} href={href}>{row.targetType} {row.targetId}</Link> : <span className="text-ink-soft">{row.targetType}</span>}</span>
                    {row.reason ? <span className="text-[12.5px] text-ink-muted">Reason: {row.reason}</span> : null}
                    {row.metadata ? (
                      <details className="text-[12.5px]">
                        <summary className="w-fit cursor-pointer text-ink-soft">Stored facts</summary>
                        <pre className="mt-1.5 overflow-x-auto rounded-[6px] border border-[#efedf3] bg-[#f9f8fb] px-2.5 py-2 font-mono text-xs text-ink-soft">{JSON.stringify(row.metadata, null, 2)}</pre>
                      </details>
                    ) : null}
                  </div>
                  <span className="whitespace-nowrap text-[12.5px] text-ink-muted"><AdminTime value={row.createdAt} /></span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Pager label="Audit pages" next={next ? query(`${next.createdAt.toISOString()}_${next.id}`) : null} nextLabel="Older entries" previous={params.cursor ? query() : null} previousLabel="Newest entries" />
    </AdminShell>
  );
}
