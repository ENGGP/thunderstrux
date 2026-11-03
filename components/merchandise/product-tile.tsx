import Link from "next/link";
import { Placeholder } from "@/components/ui/placeholder";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatPrice } from "@/lib/format";
import type { ShopProduct } from "@/lib/merchandise/shop";

// One product in a society's shop grid: 4:5 photo, name, options or stock, price.
export function ProductTile({ product, society }: { product: ShopProduct; society: string }) {
  return (
    <Link className="group grid gap-1.5 text-ink" href={`/societies/${society}/merchandise/${product.id}`}>
      {product.coverAssetId ? (
        <img alt="" className={`aspect-[4/5] w-full rounded-control border border-line bg-surface-subtle object-cover ${product.soldOut ? "opacity-70" : ""}`} decoding="async" loading="lazy" src={`/api/public/assets/${product.coverAssetId}`} />
      ) : (
        <Placeholder className="aspect-[4/5] w-full rounded-control text-5xl" initial={product.name} />
      )}
      <span className="font-semibold group-hover:underline [overflow-wrap:anywhere]">{product.name}</span>
      {product.soldOut ? (
        <StatusBadge status="sold-out" />
      ) : (
        <span className={`text-sm [overflow-wrap:anywhere] ${product.lowStock ? "font-semibold text-warning" : "text-ink-soft"}`}>{product.lowStock ? `Only ${product.lowStock} left` : product.summary || "One option"}</span>
      )}
      <span className={`font-semibold tabular-nums ${product.soldOut ? "text-ink-soft" : ""}`}>
        {!product.priceVaries ? formatPrice(product.minPrice) : product.minPrice === 0 ? `Free to ${formatPrice(product.maxPrice)}` : `From ${formatPrice(product.minPrice)}`}
      </span>
    </Link>
  );
}
