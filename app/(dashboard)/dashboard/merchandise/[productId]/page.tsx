import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { ProductActions, ProductChecklist } from "@/components/merchandise/product-actions";
import { ProductForm } from "@/components/merchandise/product-form";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireManagementPage } from "@/lib/auth/page-access";
import { formatPrice } from "@/lib/format";
import { readProduct } from "@/lib/merchandise/catalogue";

export const metadata: Metadata = { title: "Product" };

// The product editor beside its publish check and a preview of the shop card (design round B2).
export default async function ProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const organisation = await requireManagementPage("merchandise:manage", `/dashboard/merchandise/${encodeURIComponent(productId)}`);
  const found = await readProduct(organisation.id, productId);
  if (!found) notFound();
  const { product, blockers, pickupPolicy, stoppedOptions } = found;
  const archived = product.status === "archived";
  const prices = product.variants.map((variant) => variant.priceAmount);
  const low = prices.length ? Math.min(...prices) : null;
  const price = low === null ? null : `${low === Math.max(...prices) ? "" : "From "}${formatPrice(low)}`;
  const options = [...new Set(product.variants.flatMap((variant) => [variant.size, variant.colour]).filter(Boolean))];

  return (
    <DashboardShell contexts={organisation.contexts} orgName={organisation.name} staffRole={organisation.staffRole}>
      <PageHeader badge={<StatusBadge status={product.status} />} breadcrumbs={[{ label: "Merchandise", href: "/dashboard/merchandise" }]} title={product.name} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-5">
          {archived ? (
            <Notice title="Archived" tone="info">
              <p className="mt-0.5">This product isn&apos;t for sale and doesn&apos;t show to buyers. Restore it as a draft to change it or sell it again.</p>
            </Notice>
          ) : null}
          {stoppedOptions > 0 ? (
            <p className="text-sm text-ink-soft">
              {stoppedOptions === 1 ? "1 option has" : `${stoppedOptions} options have`} stopped selling. Receipts keep their details.
            </p>
          ) : null}
          <ProductForm archived={archived} orgSlug={organisation.slug} pickupPolicy={pickupPolicy} product={product} />
        </div>

        <aside aria-label="Publishing and preview" className="grid gap-5 lg:sticky lg:top-24">
          <Card>
            <div className="grid gap-4">
              <h2 className="font-display text-xl font-semibold text-ink">
                {product.status === "draft" ? (blockers.length ? "Not ready to publish" : "Ready to publish") : product.status === "published" ? "On sale" : "Archived"}
              </h2>
              {product.status === "draft" || blockers.length ? <ProductChecklist blockers={blockers} /> : null}
              {product.status === "published" ? <p className="text-ink-soft">Shown on your society&apos;s Merchandise tab.</p> : null}
              <ProductActions orgSlug={organisation.slug} product={product} publishBlocked={blockers.length > 0} />
            </div>
          </Card>
          <section aria-labelledby="preview-heading" className="grid gap-2.5">
            <h2 className="text-sm font-semibold text-ink-muted" id="preview-heading">
              How buyers see it
            </h2>
            <div className="grid gap-2 rounded-card border border-line bg-surface p-4">
              {product.imageAssetIds[0] ? (
                <img alt={`${product.name}, cover photo`} className="aspect-[4/5] w-full rounded-control border border-line object-cover" src={`/api/orgs/${organisation.slug}/assets/${product.imageAssetIds[0]}`} />
              ) : (
                <div aria-hidden="true" className="flex aspect-[4/5] items-center justify-center rounded-control border border-line bg-surface-subtle text-sm font-semibold text-ink-muted">
                  Cover photo
                </div>
              )}
              <p className="font-semibold text-ink [overflow-wrap:anywhere]">{product.name}</p>
              {options.length ? <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{options.join(" · ")}</p> : null}
              {price ? <p className="font-semibold tabular-nums text-ink">{price}</p> : null}
            </div>
          </section>
        </aside>
      </div>
    </DashboardShell>
  );
}
