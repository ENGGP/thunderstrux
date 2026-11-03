import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { Panel, rowLink, tableClass } from "@/components/admin/record";
import { EmptyState } from "@/components/ui/empty-state";
import { recordPlatformSearch } from "@/lib/platform/audit";
import { requirePlatformPage } from "@/lib/platform/authority";
import { adminEnvironment } from "@/components/admin/admin-shell";
import { searchPlatform, type SearchHit } from "@/lib/platform/search";

export const metadata: Metadata = { title: "Admin search" };

// T54 (board H3): one match opens its record; several are grouped by kind; none
// says what was checked and which environment this is. Each search is logged
// as a digest only. The callback after sign-in drops the query.
export default async function AdminSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requirePlatformPage("platform:read", "/admin/search");
  const query = ((await searchParams).q ?? "").trim().slice(0, 200);
  const hits = query ? await searchPlatform(query) : [];
  if (query) await recordPlatformSearch(actor, query, hits.length);
  if (hits.length === 1) redirect(hits[0].href);
  const groups = hits.reduce<Record<string, SearchHit[]>>((all, hit) => ({ ...all, [hit.kind]: [...(all[hit.kind] ?? []), hit] }), {});
  const environment = adminEnvironment();
  return (
    <AdminShell actor={actor} current="overview">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold">{query ? `Results for “${query}”` : "Search"}</h1>
        <p className="text-sm text-ink-soft">Paste an email, an app id, a Stripe id (cs_, pi_, acct_, re_, du_, po_), an order reference or a name.</p>
      </div>
      {query && hits.length === 0 ? (
        <EmptyState title="Nothing matches">
          This portal is {environment.label} ({environment.stripe}). An id from another environment or Stripe mode won't be here.
        </EmptyState>
      ) : null}
      {Object.entries(groups).map(([kind, rows]) => (
        <Panel key={kind} note={rows.length >= 20 ? "The first 20 matches" : undefined} title={`${kind} · ${rows.length}`}>
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead><tr><th scope="col">{kind}</th><th scope="col">Detail</th><th scope="col">Id</th></tr></thead>
              <tbody>
                {rows.map((hit) => (
                  <tr key={`${hit.kind}-${hit.id}`}>
                    <td><Link className={rowLink} href={hit.href}>{hit.label}</Link></td>
                    <td className="text-ink-soft">{hit.detail}</td>
                    <td className="font-mono text-[12.5px]">{hit.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
    </AdminShell>
  );
}
