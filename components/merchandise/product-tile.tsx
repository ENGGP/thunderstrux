import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatPrice } from "@/lib/format";
import type { ShopProduct } from "@/lib/merchandise/shop";

// One product in a society's shop grid: 4:5 photo, name, options or stock, price.
export function ProductTile({ product, society }: { product: ShopProduct; society: string }) {
  return (
    <Link className="group grid gap-1.5 text-ink" href={`/societies/${society}/merchandise/${product.id}`}>
      {product.coverAssetId ? (
        <img alt="" className={`aspect-[4/5] w-full rounded-control border border-line bg-surface-subtle object-cover ${product.soldOut ? "opacity-70" : ""}`} src={`/api/public/assets/${product.coverAssetId}`} />
      ) : (
        <span aria-hidden="true" className="aspect-[4/5] w-full rounded-control border border-line bg-surface-subtle" />
      )}
      <span className="font-semibold group-hover:underline [overflow-wrap:anywhere]">{product.name}</span>
      {product.soldOut ? (
        <StatusBadge status="sold-out" />
      ) : (
        <span className="text-sm text-ink-soft [overflow-wrap:anywhere]">{product.lowStock ? `Only ${product.lowStock} left` : product.summary || "One option"}</span>
      )}
      <span className={`font-semibold tabular-nums ${product.soldOut ? "text-ink-soft" : ""}`}>
        {!product.priceVaries ? formatPrice(product.minPrice) : product.minPrice === 0 ? `Free to ${formatPrice(product.maxPrice)}` : `From ${formatPrice(product.minPrice)}`}
      </span>
    </Link>
  );
}
