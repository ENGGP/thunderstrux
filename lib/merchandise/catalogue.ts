import { Prisma, type MerchandiseProduct, type MerchandiseVariant } from "@prisma/client";
import { z } from "zod";
import type { ApiErrorDetail } from "@/lib/api/errors";
import type { AccountActor } from "@/lib/auth/account-lifecycle";
import { assetReferenced } from "@/lib/assets/references";
import { prisma } from "@/lib/db";
import { lockOrganisationActor } from "@/lib/organisations/authority";
import { isOrganisationStripeReady } from "@/lib/stripe/connect";

// The merchandise catalogue (T25, design round B2): products a society sells
// for pickup, their photos and the options buyers pick. Every change holds
// User -> Organisation -> product -> its options (ascending id) locks, so two
// editors never interleave; T27 checkout locks options in the same order.

export const MAX_PHOTOS = 4;
export const MAX_OPTIONS = 50;
const SKU = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;

const expectedVersion = z.number().int().min(1).max(2147483646);
const label = z.string().trim().max(40, "Keep it to 40 characters.");
const optionSchema = z
  .object({
    id: z.string().min(1).max(40).optional(),
    expectedVersion: expectedVersion.optional(),
    colour: label,
    size: label,
    // Blank: we make one from the name, colour and size.
    sku: z
      .string()
      .trim()
      .max(64, "Keep it to 64 characters.")
      .transform((value) => value.toUpperCase())
      .refine((value) => value === "" || SKU.test(value), "Use letters, numbers, dots, dashes or underscores."),
    priceAmount: z.number().int().min(0).max(99_999_999),
    remaining: z.number().int().min(0, "Stock can't be below 0.").max(100_000, "Stock can be at most 100,000.")
  })
  .strict();

export const productFieldsSchema = z
  .object({
    name: z.string().trim().min(1, "Give the product a name.").max(120),
    description: z.string().trim().max(2000),
    imageAssetIds: z
      .array(z.string().min(1).max(40))
      .max(MAX_PHOTOS, `Up to ${MAX_PHOTOS} photos.`)
      .refine((ids) => new Set(ids).size === ids.length, "Each photo can be used once."),
    variants: z.array(optionSchema).max(MAX_OPTIONS, `Up to ${MAX_OPTIONS} options.`)
  })
  .strict();
export const updateProductSchema = productFieldsSchema.extend({ expectedVersion }).strict();
export const productVersionSchema = z.object({ expectedVersion }).strict();
export type ProductFields = z.infer<typeof productFieldsSchema>;

export class MerchandiseCatalogueError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
    readonly details: ApiErrorDetail[] = []
  ) {
    super(message);
    this.name = "MerchandiseCatalogueError";
  }
}

const notFound = () => new MerchandiseCatalogueError(404, "Product not found");
const invalid = (path: Array<string | number>, message: string) => new MerchandiseCatalogueError(400, message, [{ path: path.map(String), message }]);

export type ProductBlocker = {
  code: "photo_missing" | "no_options" | "no_stock" | "payments_unavailable" | "pickup_missing";
  field: string;
  message: string;
};

type ReadinessOption = Pick<MerchandiseVariant, "priceAmount" | "remaining">;

// The one place that decides whether a product may go on sale: a photo, an
// option buyers can actually get (in stock, and free or payable), and the
// society's pickup details. Like event ticket types, a product with free
// options in stock may publish before payments are set up.
export function productReadiness(
  { photos, options }: { photos: number; options: ReadinessOption[] },
  { chargesReady, pickupPolicy }: { chargesReady: boolean; pickupPolicy: string }
) {
  const blockers: ProductBlocker[] = [];
  if (photos === 0) blockers.push({ code: "photo_missing", field: "images", message: "Add a photo. Buyers see the first one on the Merchandise tab." });
  if (options.length === 0) {
    blockers.push({ code: "no_options", field: "variants", message: "Add an option buyers can pick." });
  } else if (!options.some((option) => option.remaining > 0)) {
    blockers.push({ code: "no_stock", field: "variants", message: "Give at least one option some stock." });
  } else if (!options.some((option) => option.remaining > 0 && (option.priceAmount === 0 || chargesReady))) {
    blockers.push({ code: "payments_unavailable", field: "variants", message: "Set up payments to sell paid options. Free options in stock can publish without them." });
  }
  if (!pickupPolicy.trim()) {
    blockers.push({ code: "pickup_missing", field: "pickup", message: "Add pickup details to your society profile so buyers know where to collect." });
  }
  return blockers;
}

// A saved product that is on sale must keep a photo and an option; running
// out of stock or changing prices is fine.
const keepsOnSale = (blocker: ProductBlocker) => blocker.code === "photo_missing" || blocker.code === "no_options";

const skuPart = (value: string, length: number) =>
  value.normalize("NFKD").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, length).replace(/-+$/, "");
export function suggestSku(name: string, colour: string, size: string) {
  return [skuPart(name, 20), skuPart(colour, 12), skuPart(size, 8)].filter(Boolean).join("-") || "ITEM";
}

// "Navy, Heather grey · S to XXL" for a product card or row.
export function optionSummary(colours: string[], sizes: string[]) {
  return [colours.join(", "), sizes.length > 1 ? `${sizes[0]} to ${sizes[sizes.length - 1]}` : sizes[0]].filter(Boolean).join(" · ");
}

const optionLabel = (option: { colour: string; size: string }) => [option.colour, option.size].filter(Boolean).join(", ") || "its only option";

async function lockProduct(tx: Prisma.TransactionClient, actor: AccountActor, organisationId: string, productId: string) {
  const organisation = await lockOrganisationActor(tx, actor, organisationId, "merchandise:manage");
  await tx.$queryRaw`SELECT "id" FROM "MerchandiseProduct" WHERE "id" = ${productId} AND "organisationId" = ${organisationId} FOR UPDATE`;
  const product = await tx.merchandiseProduct.findFirst({ where: { id: productId, organisationId } });
  if (!product) throw notFound();
  await tx.$queryRaw`SELECT "id" FROM "MerchandiseVariant" WHERE "productId" = ${productId} ORDER BY "id" FOR UPDATE`;
  return { organisation, product };
}

function checkVersion(product: MerchandiseProduct, version: number) {
  if (product.version !== version) throw new MerchandiseCatalogueError(409, "This product changed since you opened it. Reload it to see the latest version.");
}

function audit(tx: Prisma.TransactionClient, actor: AccountActor, product: MerchandiseProduct, action: string, metadata: Prisma.InputJsonObject = {}) {
  return tx.auditLog.create({
    data: {
      organisationId: product.organisationId,
      actorUserId: actor.id,
      action: `merchandise_product.${action}`,
      targetType: "MerchandiseProduct",
      targetId: product.id,
      metadata: { version: product.version, status: product.status, ...metadata }
    }
  });
}

// Photos: ready product images of this society, locked after the product.
async function savePhotos(tx: Prisma.TransactionClient, product: MerchandiseProduct, assetIds: string[]) {
  const previous = (await tx.merchandiseProductImage.findMany({ where: { productId: product.id }, select: { assetId: true } })).map((row) => row.assetId);
  for (const id of [...assetIds].sort()) await tx.$queryRaw`SELECT "id" FROM "Asset" WHERE "id" = ${id} FOR UPDATE`;
  const usable = await tx.asset.count({
    where: { id: { in: assetIds }, organisationId: product.organisationId, kind: "product", status: "ready", deletedAt: null }
  });
  if (usable !== assetIds.length) throw invalid(["imageAssetIds"], "A photo is no longer available. Upload it again, then save.");
  await tx.merchandiseProductImage.deleteMany({ where: { productId: product.id } });
  if (assetIds.length) {
    await tx.merchandiseProductImage.createMany({
      data: assetIds.map((assetId, position) => ({ productId: product.id, organisationId: product.organisationId, assetId, position }))
    });
  }
  // Images that lost or gained a reference start or stop their cleanup delay.
  for (const id of [...new Set([...previous, ...assetIds])].sort()) {
    await tx.asset.update({ where: { id }, data: { unreferencedAt: (await assetReferenced(tx, id)) ? null : new Date() } });
  }
}

// Options: existing ones are matched by id and version (a sale or another
// editor bumps it); new ones are created; options left out are removed while
// the product has never been on sale, and stop selling after that.
async function saveOptions(tx: Prisma.TransactionClient, product: MerchandiseProduct, name: string, inputs: ProductFields["variants"]) {
  const existing = await tx.merchandiseVariant.findMany({ where: { productId: product.id, archivedAt: null } });
  const byId = new Map(existing.map((option) => [option.id, option]));
  inputs.forEach((input, index) => {
    if (!input.id) return;
    const option = byId.get(input.id);
    if (!option) throw new MerchandiseCatalogueError(409, "An option changed since you opened this product. Reload it to see the latest version.");
    if (input.expectedVersion !== option.version) {
      throw new MerchandiseCatalogueError(409, `${optionLabel(option)} changed since you opened this product, for example a sale changed its stock. Reload it, check the numbers and save again.`, [
        { path: ["variants", String(index), "remaining"], message: "Changed since you opened this product." }
      ]);
    }
  });

  const seen = new Map<string, number>();
  inputs.forEach((input, index) => {
    const key = `${input.colour.toLowerCase()}\u0000${input.size.toLowerCase()}`;
    if (seen.has(key)) throw invalid(["variants", index, "size"], "This option is already in the list.");
    seen.set(key, index);
  });

  // SKUs are unique in the society for good, archived options included; an
  // option deleted from a never-published draft frees its SKU.
  const keptIds = new Set(inputs.map((input) => input.id).filter(Boolean));
  const freed = product.firstPublishedAt ? [] : existing.map((option) => option.id);
  const taken = new Map(
    (await tx.merchandiseVariant.findMany({
      where: { organisationId: product.organisationId, id: { notIn: [...keptIds, ...freed] as string[] } },
      select: { sku: true, colour: true, size: true, product: { select: { name: true } } }
    })).map((option) => [option.sku, `${option.product.name}, ${optionLabel(option)}`])
  );
  const skus = inputs.map((input) => input.sku);
  skus.forEach((sku, index) => {
    if (!sku) return;
    const owner = taken.get(sku) ?? (skus.indexOf(sku) !== index ? "another option here" : null);
    if (owner) throw invalid(["variants", index, "sku"], `${sku} is already used by ${owner}. Each option needs its own SKU.`);
  });
  const used = new Set([...taken.keys(), ...skus.filter(Boolean)]);
  const finalSkus = skus.map((sku, index) => {
    if (sku) return sku;
    const base = suggestSku(name, inputs[index].colour, inputs[index].size).slice(0, 58);
    let candidate = base;
    for (let n = 2; used.has(candidate); n += 1) candidate = `${base}-${n}`;
    used.add(candidate);
    return candidate;
  });

  const now = new Date();
  for (const option of existing.filter((option) => !keptIds.has(option.id))) {
    if (product.firstPublishedAt) {
      await tx.merchandiseVariant.update({ where: { id: option.id }, data: { archivedAt: now, version: { increment: 1 } } });
    } else {
      await tx.merchandiseVariant.delete({ where: { id: option.id } });
    }
  }
  for (const [position, input] of inputs.entries()) {
    const data = { colour: input.colour, size: input.size, sku: finalSkus[position], priceAmount: input.priceAmount, remaining: input.remaining, position };
    const option = input.id ? byId.get(input.id) : undefined;
    if (!option) {
      await tx.merchandiseVariant.create({ data: { ...data, productId: product.id, organisationId: product.organisationId } });
    } else if ((Object.keys(data) as Array<keyof typeof data>).some((key) => data[key] !== option[key])) {
      await tx.merchandiseVariant.update({ where: { id: option.id }, data: { ...data, version: { increment: 1 } } });
    }
  }
}

async function organisationReadiness(tx: Prisma.TransactionClient, organisation: { stripeAccountId: string | null; stripeChargesEnabled: boolean; pickupPolicy: string }, productId: string) {
  const [photos, options] = await Promise.all([
    tx.merchandiseProductImage.count({ where: { productId } }),
    tx.merchandiseVariant.findMany({ where: { productId, archivedAt: null }, select: { priceAmount: true, remaining: true } })
  ]);
  return productReadiness({ photos, options }, { chargesReady: isOrganisationStripeReady(organisation), pickupPolicy: organisation.pickupPolicy });
}

const refusal = (blockers: ProductBlocker[]) =>
  new MerchandiseCatalogueError(409, blockers[0].message, blockers.map((blocker) => ({ path: [blocker.field], message: blocker.message, reason: blocker.code })));

// Two edits racing on a new SKU end at the unique index: same answer as the check.
async function withSkuConflict<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new MerchandiseCatalogueError(409, "That SKU was just taken by another option. Choose another and save again.");
    }
    throw error;
  }
}

export async function createProduct(actor: AccountActor, organisationId: string, input: ProductFields) {
  const fields = productFieldsSchema.parse(input);
  if (fields.variants.some((option) => option.id)) throw invalid(["variants"], "A new product has no saved options yet.");
  return withSkuConflict(() =>
    prisma.$transaction(async (tx) => {
      await lockOrganisationActor(tx, actor, organisationId, "merchandise:manage");
      const product = await tx.merchandiseProduct.create({ data: { organisationId, name: fields.name, description: fields.description } });
      await savePhotos(tx, product, fields.imageAssetIds);
      await saveOptions(tx, product, fields.name, fields.variants);
      await audit(tx, actor, product, "created", { photos: fields.imageAssetIds.length, options: fields.variants.length });
      return product;
    })
  );
}

export async function updateProduct(actor: AccountActor, organisationId: string, productId: string, input: z.infer<typeof updateProductSchema>) {
  const { expectedVersion: version, ...fields } = updateProductSchema.parse(input);
  return withSkuConflict(() =>
    prisma.$transaction(async (tx) => {
      const { organisation, product } = await lockProduct(tx, actor, organisationId, productId);
      checkVersion(product, version);
      if (product.status === "archived") throw new MerchandiseCatalogueError(409, "Archived products can't be changed. Restore it as a draft first.");
      const updated = await tx.merchandiseProduct.update({
        where: { id: product.id },
        data: { name: fields.name, description: fields.description, version: { increment: 1 } }
      });
      await savePhotos(tx, updated, fields.imageAssetIds);
      await saveOptions(tx, updated, fields.name, fields.variants);
      if (updated.status === "published") {
        const blockers = (await organisationReadiness(tx, organisation, updated.id)).filter(keepsOnSale);
        if (blockers.length) throw refusal(blockers);
      }
      await audit(tx, actor, updated, "updated", { photos: fields.imageAssetIds.length, options: fields.variants.length });
      return updated;
    })
  );
}

// Publishing a published product returns it unchanged.
export async function publishProduct(actor: AccountActor, organisationId: string, productId: string, input: z.infer<typeof productVersionSchema>) {
  const { expectedVersion: version } = productVersionSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const { organisation, product } = await lockProduct(tx, actor, organisationId, productId);
    if (product.status === "published") return product;
    checkVersion(product, version);
    if (product.status === "archived") throw new MerchandiseCatalogueError(409, "Restore this product as a draft before publishing it.");
    const blockers = await organisationReadiness(tx, organisation, product.id);
    if (blockers.length) throw refusal(blockers);
    const now = new Date();
    const published = await tx.merchandiseProduct.update({
      where: { id: product.id },
      data: { status: "published", publishedAt: now, firstPublishedAt: product.firstPublishedAt ?? now, version: { increment: 1 } }
    });
    await audit(tx, actor, published, "published");
    return published;
  });
}

// Archiving stops sales and leaves the shop; orders already placed are unaffected.
export async function archiveProduct(actor: AccountActor, organisationId: string, productId: string, input: z.infer<typeof productVersionSchema>) {
  const { expectedVersion: version } = productVersionSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const { product } = await lockProduct(tx, actor, organisationId, productId);
    if (product.status === "archived") return product;
    checkVersion(product, version);
    const archived = await tx.merchandiseProduct.update({
      where: { id: product.id },
      data: { status: "archived", archivedAt: new Date(), publishedAt: null, version: { increment: 1 } }
    });
    await audit(tx, actor, archived, "archived");
    return archived;
  });
}

// Restore brings an archived product back as a draft, to publish again later.
export async function restoreProduct(actor: AccountActor, organisationId: string, productId: string, input: z.infer<typeof productVersionSchema>) {
  const { expectedVersion: version } = productVersionSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const { product } = await lockProduct(tx, actor, organisationId, productId);
    if (product.status !== "archived") return product;
    checkVersion(product, version);
    const restored = await tx.merchandiseProduct.update({
      where: { id: product.id },
      data: { status: "draft", archivedAt: null, version: { increment: 1 } }
    });
    await audit(tx, actor, restored, "restored");
    return restored;
  });
}

const optionSelect = { id: true, colour: true, size: true, sku: true, priceAmount: true, remaining: true, version: true } as const;

// Staff view of one product: the editor's values and what stands between it and sale.
export async function readProduct(organisationId: string, productId: string) {
  const [organisation, product] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: organisationId }, select: { stripeAccountId: true, stripeChargesEnabled: true, pickupPolicy: true } }),
    prisma.merchandiseProduct.findFirst({
      where: { id: productId, organisationId },
      include: {
        images: { orderBy: { position: "asc" }, select: { assetId: true } },
        variants: { where: { archivedAt: null }, orderBy: [{ position: "asc" }, { id: "asc" }], select: optionSelect }
      }
    })
  ]);
  if (!product) return null;
  const stopped = await prisma.merchandiseVariant.count({ where: { productId: product.id, archivedAt: { not: null } } });
  const chargesReady = isOrganisationStripeReady(organisation);
  return {
    product: {
      id: product.id,
      name: product.name,
      description: product.description,
      status: product.status,
      everPublished: product.firstPublishedAt !== null,
      version: product.version,
      imageAssetIds: product.images.map((image) => image.assetId),
      variants: product.variants
    },
    stoppedOptions: stopped,
    chargesReady,
    pickupPolicy: organisation.pickupPolicy,
    blockers:
      product.status === "archived" ? [] : productReadiness({ photos: product.images.length, options: product.variants }, { chargesReady, pickupPolicy: organisation.pickupPolicy })
  };
}
export type StaffProduct = NonNullable<Awaited<ReturnType<typeof readProduct>>>["product"];

// Every product of the society, newest first, with its cover photo and a
// summary of the options still on sale.
export async function listProducts(organisationId: string) {
  const [organisation, products] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: organisationId }, select: { pickupPolicy: true } }),
    prisma.merchandiseProduct.findMany({
      where: { organisationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      include: {
        images: { where: { position: 0 }, select: { assetId: true } },
        variants: { where: { archivedAt: null }, select: { colour: true, size: true, priceAmount: true, remaining: true } }
      }
    })
  ]);
  return {
    pickupPolicy: organisation.pickupPolicy,
    products: products.map((product) => {
      const prices = product.variants.map((option) => option.priceAmount);
      const distinct = (values: string[]) => [...new Set(values.filter(Boolean))];
      return {
        id: product.id,
        name: product.name,
        status: product.status,
        coverAssetId: product.images[0]?.assetId ?? null,
        options: product.variants.length,
        remaining: product.variants.reduce((total, option) => total + option.remaining, 0),
        colours: distinct(product.variants.map((option) => option.colour)),
        sizes: distinct(product.variants.map((option) => option.size)),
        minPrice: prices.length ? Math.min(...prices) : null,
        maxPrice: prices.length ? Math.max(...prices) : null
      };
    })
  };
}
