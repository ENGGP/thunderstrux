import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkTabs } from "@/components/ui/link-tabs";
import { ListSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireManagementPage } from "@/lib/auth/page-access";
import { formatPrice } from "@/lib/format";
import { listProducts, optionSummary } from "@/lib/merchandise/catalogue";
import { toPrepareCount } from "@/lib/merchandise/pickups";

export const metadata: Metadata = { title: "Merchandise" };

// Products (T25, design round B2), beside the Pickups tab (T28a).
export default async function MerchandisePage() {
  const organisation = await requireManagementPage("merchandise:manage", "/dashboard/merchandise");
  const toPrepare = await toPrepareCount(organisation.id);
  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader
        actions={
          <Link className={buttonClasses()} href="/dashboard/merchandise/new">
            New product
          </Link>
        }
        description="Things your society sells for pickup. There's no shipping."
        title="Merchandise"
      />
      <LinkTabs
        label="Merchandise sections"
        tabs={[
          { href: "/dashboard/merchandise", label: "Products", active: true },
          { href: "/dashboard/merchandise/pickups", label: toPrepare ? `Pickups · ${toPrepare} to prepare` : "Pickups", active: false }
        ]}
      />
      <Suspense fallback={<ListSkeleton label="Loading products" />}>
        <Products organisationId={organisation.id} orgSlug={organisation.slug} />
      </Suspense>
    </DashboardShell>
  );
}

type Row = Awaited<ReturnType<typeof listProducts>>["products"][number];

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const price = (row: Row) =>
  row.minPrice === null ? "No options" : row.minPrice === row.maxPrice ? formatPrice(row.minPrice) : `${formatPrice(row.minPrice)} to ${formatPrice(row.maxPrice ?? row.minPrice)}`;
const soldOut = (row: Row) => row.status !== "archived" && row.options > 0 && row.remaining === 0;

async function Products({ organisationId, orgSlug }: { organisationId: string; orgSlug: string }) {
  const { products, pickupPolicy } = await listProducts(organisationId);
  if (!products.length) {
    return (
      <EmptyState
        action={
          <Link className={buttonClasses()} href="/dashboard/merchandise/new">
            New product
          </Link>
        }
        icon="bag"
        title="No products yet"
      >
        Sell hoodies, pins or tote bags for pickup. Buyers pay online and collect in person.
      </EmptyState>
    );
  }
  const titleLink = "font-semibold text-ink underline-offset-4 hover:underline [overflow-wrap:anywhere]";
  const cover = (row: Row) =>
    row.coverAssetId ? (
      <img alt="" className="h-[50px] w-10 shrink-0 rounded-[6px] border border-line object-cover" src={`/api/orgs/${orgSlug}/assets/${row.coverAssetId}`} />
    ) : (
      <span aria-hidden="true" className="h-[50px] w-10 shrink-0 rounded-[6px] border border-line bg-surface-subtle" />
    );
  const stock = (row: Row) => (soldOut(row) ? <StatusBadge status="sold-out" /> : row.status === "archived" ? "No longer sold" : `${plural(row.options, "option")} · ${row.remaining} left`);
  const action = (row: Row) => (
    <Link aria-label={`${row.status === "archived" ? "Details for" : "Edit"} ${row.name}`} className={buttonClasses({ variant: "secondary", size: "sm" })} href={`/dashboard/merchandise/${row.id}`}>
      {row.status === "archived" ? "Details" : "Edit"}
    </Link>
  );

  return (
    <>
      <div className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
        <table className="w-full min-w-[760px] border-collapse text-left text-[15px]">
          <thead>
            <tr className="text-[13px] text-ink-soft">
              <th className="px-5 py-3.5 font-semibold" scope="col">Product</th>
              <th className="px-3 py-3.5 font-semibold" scope="col">Status</th>
              <th className="px-3 py-3.5 font-semibold" scope="col">Options and stock</th>
              <th className="px-3 py-3.5 font-semibold" scope="col">Price</th>
              <th className="px-5 py-3.5 text-right font-semibold" scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((row) => (
              <tr className="border-t border-line align-top" key={row.id}>
                <td className="px-5 py-4">
                  <div className="flex gap-3">
                    {cover(row)}
                    <div className="min-w-0">
                      <Link className={titleLink} href={`/dashboard/merchandise/${row.id}`}>
                        {row.name}
                      </Link>
                      <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{row.status === "draft" ? "Not on sale" : optionSummary(row.colours, row.sizes) || "One option"}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-4">
                  <StatusBadge status={row.status} />
                </td>
                <td className="px-3 py-4">{stock(row)}</td>
                <td className="whitespace-nowrap px-3 py-4 tabular-nums">{price(row)}</td>
                <td className="px-5 py-4">
                  <div className="flex justify-end">{action(row)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="grid gap-4 md:hidden">
        {products.map((row) => (
          <li className="grid gap-2 rounded-card border border-line bg-surface p-4" key={row.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 gap-3">
                {cover(row)}
                <Link className={titleLink} href={`/dashboard/merchandise/${row.id}`}>
                  {row.name}
                </Link>
              </div>
              <StatusBadge status={soldOut(row) ? "sold-out" : row.status} />
            </div>
            <p className="text-sm text-ink-soft">
              {row.status === "archived" ? "No longer sold" : `${plural(row.options, "option")} · ${row.remaining} left`} · {price(row)}
            </p>
            <div>{action(row)}</div>
          </li>
        ))}
      </ul>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="grid content-start gap-2 rounded-card border border-line bg-surface p-5">
          <h2 className="font-semibold text-ink">Pickup details</h2>
          <p className="whitespace-pre-wrap text-sm text-ink-soft [overflow-wrap:anywhere]">
            {pickupPolicy ? `Shown on every product, the basket and receipts: ${pickupPolicy}` : "None yet. Products can't go on sale until buyers know where to collect."}
          </p>
          <Link className="w-fit text-sm font-semibold text-brand underline underline-offset-4" href="/dashboard/settings/profile">
            {pickupPolicy ? "Change in Society profile" : "Add them in Society profile"}
          </Link>
        </section>
        <section className="grid content-start gap-2 rounded-card border border-line bg-surface p-5">
          <h2 className="font-semibold text-ink">Sold items keep their details</h2>
          <p className="text-sm text-ink-soft">Receipts keep the name, option and price each buyer paid, even after you edit or archive a product. Products are archived, never deleted.</p>
        </section>
      </div>
    </>
  );
}
