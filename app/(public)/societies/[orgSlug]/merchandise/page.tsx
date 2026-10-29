import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductTile } from "@/components/merchandise/product-tile";
import { BasketLink } from "@/components/merchandise/shop";
import { SocietyHeader } from "@/components/organisations/society-header";
import { Icon } from "@/components/ui/icon";
import { Pager } from "@/components/ui/pager";
import { membershipOffers } from "@/lib/memberships/offers";
import { shopProducts } from "@/lib/merchandise/shop";
import { publicOrganisation } from "@/lib/organisations/public-organisations";
import { societyViewer } from "../viewer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Merchandise" };

// PUB-07 (T26, design round B2): a society's published products, pickup only.
export default async function SocietyMerchandisePage({
  params,
  searchParams
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ cursor?: string; direction?: string }>;
}) {
  const page = await searchParams;
  const organisation = await publicOrganisation((await params).orgSlug);
  if (!organisation) notFound();
  const viewer = await societyViewer(organisation.id);
  const [{ offers, memberUntil }, { products, nextCursor, previousCursor }] = await Promise.all([
    membershipOffers(organisation.id, viewer.memberId),
    shopProducts(organisation.id, { cursor: page.cursor, direction: page.direction === "prev" ? "prev" : "next" })
  ]);
  const pageHref = (cursor: string, direction: "next" | "prev") => `/societies/${organisation.slug}/merchandise?${new URLSearchParams({ cursor, direction })}`;

  return (
    <main id="main" tabIndex={-1} className="bg-paper pb-14">
      <div className="mx-auto max-w-page px-4 md:px-8">
        <SocietyHeader current="merchandise" hasMemberships={offers.length > 0} hasMerchandise joined={viewer.joinState === "joined"} memberUntil={memberUntil} organisation={organisation} />

        <section aria-labelledby="merch-heading" className="mt-8 grid gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-2xl font-semibold text-ink" id="merch-heading">
                Merchandise
              </h2>
              <span className="rounded-tag border border-neutral-border bg-neutral-bg px-2 py-0.5 text-xs font-semibold text-neutral">Pickup only</span>
            </div>
            {products.length ? <BasketLink society={organisation.slug} /> : null}
          </div>
          {products.length === 0 ? (
            <section className="grid gap-2 rounded-card border border-line bg-surface p-6">
              <h3 className="font-display text-lg font-semibold text-ink">No merchandise on sale right now</h3>
              <p className="text-ink-soft">
                Check back later, or see what&apos;s on at{" "}
                <Link className="font-semibold text-brand underline underline-offset-4" href={`/societies/${organisation.slug}`}>
                  {organisation.name}
                </Link>
                .
              </p>
            </section>
          ) : (
            <>
              <p className="max-w-[70ch] text-ink-soft">Buy online, collect in person. There&apos;s no delivery.</p>
              {organisation.pickupPolicy ? (
                <div className="flex flex-wrap items-start gap-x-8 gap-y-2 rounded-card border border-line bg-surface px-5 py-4 text-ui">
                  <span className="flex flex-1 basis-80 items-start gap-2.5">
                    <Icon className="mt-0.5 text-brand" name="pin" />
                    <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                      <strong>Pickup:</strong> {organisation.pickupPolicy}
                    </span>
                  </span>
                  {organisation.supportEmail ? (
                    <span className="[overflow-wrap:anywhere]">
                      Questions:{" "}
                      <a className="text-brand underline underline-offset-4" href={`mailto:${organisation.supportEmail}`}>
                        {organisation.supportEmail}
                      </a>
                    </span>
                  ) : null}
                </div>
              ) : null}
              <ul className="grid grid-cols-2 gap-x-4 gap-y-7 md:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
                {products.map((product) => (
                  <li key={product.id}>
                    <ProductTile product={product} society={organisation.slug} />
                  </li>
                ))}
              </ul>
              <Pager label="Product pages" next={nextCursor && pageHref(nextCursor, "next")} nextLabel="More products" previous={previousCursor && pageHref(previousCursor, "prev")} />
              {organisation.refundPolicy ? (
                <div>
                  <h3 className="font-semibold text-ink">Refunds</h3>
                  <p className="mt-1 max-w-[70ch] whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">{organisation.refundPolicy}</p>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
