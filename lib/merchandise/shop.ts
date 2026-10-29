import { z } from "zod";
import { prisma } from "@/lib/db";
import { LOW_STOCK, MAX_BASKET_LINES, MAX_LINE_QUANTITY } from "@/lib/merchandise/basket";
import { optionSummary } from "@/lib/merchandise/catalogue";
import { heldByVariant, quoteVersion } from "@/lib/merchandise/sale";
import { cursorPage, pageInfoForPage, type PaginationDirection } from "@/lib/pagination/cursor";

// A shop page fills whole rows of two, three or four tiles.
export const shopPageSize = 24;

// What anyone may see of a society's merchandise (T26, design round B2):
// published products, their photos and the options still on sale. Drafts,
// archived products and options that stopped selling are never returned.
// Prices and stock here are advice; checkout re-quotes under locks (lib/merchandise/sale.ts).

const optionSelect = { id: true, colour: true, size: true, priceAmount: true, remaining: true } as const;
const liveProduct = (organisationId: string) => ({ organisationId, status: "published" as const });

// What buyers can still get: the stock left less other checkouts' holds.
async function availability(options: Array<{ id: string }>) {
  const held = await heldByVariant(prisma, options.map((option) => option.id), new Date());
  return (option: { id: string; remaining: number }) => Math.max(0, option.remaining - (held.get(option.id) ?? 0));
}

// Newest published first, a page at a time both ways (UI-025).
export async function shopProducts(organisationId: string, page: { cursor?: string; direction?: PaginationDirection } = {}) {
  const query = cursorPage("publishedAt", "desc", page);
  const rows = await prisma.merchandiseProduct.findMany({
    where: { AND: [liveProduct(organisationId), ...query.after] },
    orderBy: query.orderBy,
    take: shopPageSize + 1,
    select: {
      id: true,
      name: true,
      publishedAt: true,
      images: { where: { position: 0 }, select: { assetId: true } },
      variants: { where: { archivedAt: null }, orderBy: [{ position: "asc" }, { id: "asc" }], select: optionSelect }
    }
  });
  // A published product always has publishedAt (MerchandiseProduct_published_chk).
  const { items: products, pageInfo } = pageInfoForPage({
    items: rows.map((row) => ({ ...row, publishedAt: row.publishedAt as Date })),
    limit: shopPageSize,
    direction: query.from.direction,
    cursor: query.from.cursor,
    timestampField: "publishedAt"
  });
  const available = await availability(products.flatMap((product) => product.variants));
  const tiles = products.map((product) => {
    const prices = product.variants.map((option) => option.priceAmount);
    const left = product.variants.reduce((total, option) => total + available(option), 0);
    const distinct = (values: string[]) => [...new Set(values.filter(Boolean))];
    return {
      id: product.id,
      name: product.name,
      coverAssetId: product.images[0]?.assetId ?? null,
      summary: optionSummary(distinct(product.variants.map((option) => option.colour)), distinct(product.variants.map((option) => option.size))),
      minPrice: prices.length ? Math.min(...prices) : 0,
      maxPrice: prices.length ? Math.max(...prices) : 0,
      priceVaries: new Set(prices).size > 1,
      soldOut: left === 0,
      lowStock: left > 0 && left <= LOW_STOCK ? left : null
    };
  });
  return { products: tiles, nextCursor: pageInfo.nextCursor, previousCursor: pageInfo.previousCursor };
}
export type ShopProduct = Awaited<ReturnType<typeof shopProducts>>["products"][number];

export function hasShop(organisationId: string) {
  return prisma.merchandiseProduct.count({ where: liveProduct(organisationId) }).then((count) => count > 0);
}

export async function shopProduct(organisationId: string, productId: string) {
  const product = await prisma.merchandiseProduct.findFirst({
    where: { id: productId, ...liveProduct(organisationId) },
    select: {
      id: true,
      name: true,
      description: true,
      images: { orderBy: { position: "asc" }, select: { assetId: true } },
      variants: { where: { archivedAt: null }, orderBy: [{ position: "asc" }, { id: "asc" }], select: optionSelect }
    }
  });
  if (!product) return null;
  const available = await availability(product.variants);
  return {
    ...product,
    imageAssetIds: product.images.map((image) => image.assetId),
    variants: product.variants.map(({ remaining, ...option }) => ({ ...option, available: available({ ...option, remaining }) }))
  };
}
export type ShopProductDetail = NonNullable<Awaited<ReturnType<typeof shopProduct>>>;

export const quoteSchema = z
  .object({
    society: z.string().trim().min(1).max(100),
    items: z
      .array(z.object({ variantId: z.string().min(1).max(40), quantity: z.number().int().min(1).max(100) }).strict())
      .max(50)
  })
  .strict();
export type QuoteInput = z.infer<typeof quoteSchema>;

export type QuoteProblem = "unavailable" | "sold_out" | "reduced" | "too_many_lines";

// The basket's truth: each line priced and checked against today's stock.
// Repeated options merge; quantities above ten or above what's left come
// back lowered with a reason; lines past ten, options no longer sold and
// other societies' options come back as problems. The version changes
// whenever a price, quantity or line changes, so checkout can refuse
// a stale basket.
export async function quoteBasket(input: QuoteInput) {
  const { society, items } = quoteSchema.parse(input);
  const organisation = await prisma.organisation.findUnique({ where: { slug: society }, select: { id: true, name: true, slug: true, pickupPolicy: true, refundPolicy: true, supportEmail: true } });
  if (!organisation) return null;

  const wanted = new Map<string, number>();
  for (const item of items) wanted.set(item.variantId, (wanted.get(item.variantId) ?? 0) + item.quantity);
  const options = await prisma.merchandiseVariant.findMany({
    where: { id: { in: [...wanted.keys()] }, organisationId: organisation.id, archivedAt: null, product: { status: "published" } },
    select: { ...optionSelect, product: { select: { id: true, name: true, images: { where: { position: 0 }, select: { assetId: true } } } } }
  });
  const byId = new Map(options.map((option) => [option.id, option]));
  const available = await availability(options);

  const lines = [];
  const problems: Array<{ variantId: string; problem: QuoteProblem }> = [];
  for (const [variantId, requested] of wanted) {
    const option = byId.get(variantId);
    if (!option) {
      problems.push({ variantId, problem: "unavailable" });
      continue;
    }
    if (lines.length === MAX_BASKET_LINES) {
      problems.push({ variantId, problem: "too_many_lines" });
      continue;
    }
    const left = available(option);
    const quantity = Math.min(requested, MAX_LINE_QUANTITY, left);
    if (left === 0) problems.push({ variantId, problem: "sold_out" });
    else if (quantity < requested) problems.push({ variantId, problem: "reduced" });
    lines.push({
      variantId,
      productId: option.product.id,
      name: option.product.name,
      option: [option.colour, option.size].filter(Boolean).join(" · "),
      coverAssetId: option.product.images[0]?.assetId ?? null,
      unitPrice: option.priceAmount,
      quantity,
      lineTotal: option.priceAmount * quantity,
      available: left
    });
  }
  const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const version = quoteVersion(lines);
  return {
    society: { name: organisation.name, slug: organisation.slug },
    lines,
    problems,
    total,
    version,
    pickupPolicy: organisation.pickupPolicy,
    refundPolicy: organisation.refundPolicy,
    supportEmail: organisation.supportEmail
  };
}
export type Quote = NonNullable<Awaited<ReturnType<typeof quoteBasket>>>;
