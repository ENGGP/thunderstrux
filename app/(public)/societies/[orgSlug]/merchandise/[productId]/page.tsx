import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BasketLink, ProductPicker } from "@/components/merchandise/shop";
import { shopProduct } from "@/lib/merchandise/shop";
import { publicOrganisation } from "@/lib/organisations/public-organisations";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ orgSlug: string; productId: string }> };

async function load(params: Props["params"]) {
  const { orgSlug, productId } = await params;
  const organisation = await publicOrganisation(orgSlug);
  const product = organisation ? await shopProduct(organisation.id, productId) : null;
  return organisation && product ? { organisation, product } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await load(params);
  return found ? { title: `${found.product.name} · ${found.organisation.name}` } : {};
}

// PUB-08 (T26, design round B2): one published product. Drafts, archived
// products and other societies' products are not found.
export default async function ProductPage({ params }: Props) {
  const found = await load(params);
  if (!found) notFound();
  const { organisation, product } = found;

  return (
    <main id="main" tabIndex={-1} className="bg-paper pb-14">
      <div className="mx-auto grid max-w-page gap-6 px-4 py-7 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Breadcrumb" className="text-sm">
            <Link className="text-brand underline underline-offset-4" href={`/societies/${organisation.slug}`}>
              {organisation.name}
            </Link>
            <span aria-hidden="true" className="px-2 text-ink-muted">/</span>
            <Link className="text-brand underline underline-offset-4" href={`/societies/${organisation.slug}/merchandise`}>
              Merchandise
            </Link>
          </nav>
          <BasketLink society={organisation.slug} />
        </div>
        <ProductPicker product={product} society={organisation.slug} societyName={organisation.name} />
        <section aria-label="Pickup" className="grid max-w-3xl gap-1.5 rounded-card border border-line bg-surface p-5 text-ui">
          <strong>Collect it in person, no delivery</strong>
          {organisation.pickupPolicy ? <span className="whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">{organisation.pickupPolicy}</span> : null}
          {organisation.refundPolicy ? <span className="whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">Refund policy: {organisation.refundPolicy}</span> : null}
          {organisation.supportEmail ? (
            <span className="text-ink-soft [overflow-wrap:anywhere]">
              Questions:{" "}
              <a className="text-brand underline underline-offset-4" href={`mailto:${organisation.supportEmail}`}>
                {organisation.supportEmail}
              </a>
            </span>
          ) : null}
        </section>
      </div>
    </main>
  );
}
