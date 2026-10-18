import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BasketView } from "@/components/merchandise/shop";
import { publicOrganisation } from "@/lib/organisations/public-organisations";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Merchandise basket" };

// BUY-06 (T26, design round B2): one society's basket, kept on this device and
// re-quoted by the server on every view.
export default async function BasketPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const organisation = await publicOrganisation((await params).orgSlug);
  if (!organisation) notFound();
  return (
    <main className="bg-paper pb-14">
      <div className="mx-auto grid max-w-page gap-6 px-4 py-7 md:px-8">
        <Link className="w-fit text-[15px] font-semibold text-brand underline underline-offset-4" href={`/societies/${organisation.slug}/merchandise`}>
          Keep shopping at {organisation.name}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-semibold text-ink [overflow-wrap:anywhere]">{organisation.name} merchandise basket</h1>
          <span className="rounded-tag border border-neutral-border bg-neutral-bg px-2 py-0.5 text-xs font-semibold text-neutral">Pickup only</span>
        </div>
        <BasketView society={organisation.slug} />
      </div>
    </main>
  );
}
