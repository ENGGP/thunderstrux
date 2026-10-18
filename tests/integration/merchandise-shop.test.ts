import { describe, expect, test } from "vitest";
import { POST as quoteRoute } from "@/app/api/merchandise/quote/route";
import { prisma } from "@/lib/db";
import { hasShop, shopProduct, shopProducts } from "@/lib/merchandise/shop";
import { jsonRequest, parseJsonResponse } from "@/tests/helpers/http";
import { createOrganisationAccount, unique } from "@/tests/helpers/test-data";

// A product as T25 leaves it, with its options; published unless told otherwise.
async function product(organisationId: string, uploadedByUserId: string, options: Array<{ colour?: string; size?: string; priceAmount: number; remaining: number; archived?: boolean }>, status: "draft" | "published" | "archived" = "published") {
  const now = new Date();
  const created = await prisma.merchandiseProduct.create({
    data: {
      organisationId, name: unique("Hoodie"), status,
      publishedAt: status === "published" ? now : null, firstPublishedAt: status === "draft" ? null : now, archivedAt: status === "archived" ? now : null
    }
  });
  const photo = await prisma.asset.create({ data: { organisationId, uploadedByUserId, storageKey: unique("assets/shop"), kind: "product", status: "ready", byteSize: 10, width: 8, height: 10, sha256: "0".repeat(64) } });
  await prisma.merchandiseProductImage.create({ data: { productId: created.id, organisationId, assetId: photo.id, position: 0 } });
  const variants = [];
  for (const [position, option] of options.entries()) {
    variants.push(await prisma.merchandiseVariant.create({
      data: { productId: created.id, organisationId, colour: option.colour ?? "", size: option.size ?? "", sku: unique("SKU").toUpperCase(), priceAmount: option.priceAmount, remaining: option.remaining, position, archivedAt: option.archived ? now : null }
    }));
  }
  return { product: created, variants };
}

async function quote(body: unknown) {
  const response = await quoteRoute(jsonRequest("http://localhost:3000/api/merchandise/quote", body));
  return { status: response.status, body: await parseJsonResponse(response), cache: response.headers.get("Cache-Control") };
}

describe("merchandise shop", () => {
  test("buyers see published products only, with options still on sale, low stock and sold out", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const hoodie = await product(organisation.id, user.id, [
      { colour: "Navy", size: "M", priceAmount: 4500, remaining: 3 },
      { colour: "Navy", size: "XXL", priceAmount: 4800, remaining: 0 },
      { colour: "Navy", size: "S", priceAmount: 4500, remaining: 9, archived: true }
    ]);
    const cap = await product(organisation.id, user.id, [{ priceAmount: 2500, remaining: 0 }]);
    const draft = await product(organisation.id, user.id, [{ priceAmount: 100, remaining: 5 }], "draft");
    const archived = await product(organisation.id, user.id, [{ priceAmount: 100, remaining: 5 }], "archived");
    const other = await createOrganisationAccount();
    const foreign = await product(other.organisation.id, other.user.id, [{ priceAmount: 100, remaining: 5 }]);

    const listed = await shopProducts(organisation.id);
    expect(listed.map((row) => row.id).sort()).toEqual([hoodie.product.id, cap.product.id].sort());
    expect(listed.find((row) => row.id === hoodie.product.id)).toMatchObject({ summary: "Navy · M to XXL", minPrice: 4500, priceVaries: true, soldOut: false, lowStock: 3 });
    expect(listed.find((row) => row.id === cap.product.id)).toMatchObject({ soldOut: true, lowStock: null, priceVaries: false });
    expect(await hasShop(organisation.id)).toBe(true);
    expect(await hasShop((await createOrganisationAccount()).organisation.id)).toBe(false);

    const detail = await shopProduct(organisation.id, hoodie.product.id);
    expect(detail?.variants.map((option) => option.size)).toEqual(["M", "XXL"]);
    expect(detail?.variants[0]).toEqual({ id: hoodie.variants[0].id, colour: "Navy", size: "M", priceAmount: 4500, available: 3 });
    for (const hidden of [draft.product.id, archived.product.id, foreign.product.id]) expect(await shopProduct(organisation.id, hidden)).toBeNull();
  });

  test("a quote merges repeats, lowers quantities to the limit and to what's left, and drops options it can't sell", async () => {
    const { user, organisation } = await createOrganisationAccount();
    await prisma.organisation.update({ where: { id: organisation.id }, data: { pickupPolicy: "EngSoc office", refundPolicy: "14 days" } });
    const { variants } = await product(organisation.id, user.id, [
      { colour: "Navy", size: "L", priceAmount: 4500, remaining: 50 },
      { colour: "Natural", priceAmount: 1500, remaining: 2 },
      { size: "XXL", priceAmount: 4800, remaining: 0 },
      { priceAmount: 0, remaining: 100 },
      { priceAmount: 100, remaining: 5, archived: true }
    ]);
    const draft = await product(organisation.id, user.id, [{ priceAmount: 100, remaining: 5 }], "draft");
    const other = await createOrganisationAccount();
    const foreign = await product(other.organisation.id, other.user.id, [{ priceAmount: 100, remaining: 5 }]);

    const result = await quote({
      society: organisation.slug,
      items: [
        { variantId: variants[0].id, quantity: 4 },
        { variantId: variants[0].id, quantity: 8 },
        { variantId: variants[1].id, quantity: 5 },
        { variantId: variants[2].id, quantity: 1 },
        { variantId: variants[3].id, quantity: 2 },
        { variantId: variants[4].id, quantity: 1 },
        { variantId: draft.variants[0].id, quantity: 1 },
        { variantId: foreign.variants[0].id, quantity: 1 }
      ]
    });
    expect(result.status).toBe(200);
    expect(result.cache).toBe("no-store");
    const { lines, problems, total, pickupPolicy, refundPolicy, checkoutEnabled } = result.body.quote;
    expect(lines.map((line: { variantId: string; quantity: number; lineTotal: number }) => [line.variantId, line.quantity, line.lineTotal])).toEqual([
      [variants[0].id, 10, 45000],
      [variants[1].id, 2, 3000],
      [variants[2].id, 0, 0],
      [variants[3].id, 2, 0]
    ]);
    expect(lines[0]).toMatchObject({ option: "Navy · L", unitPrice: 4500, available: 50 });
    expect(total).toBe(48000);
    expect(problems).toEqual([
      { variantId: variants[0].id, problem: "reduced" },
      { variantId: variants[1].id, problem: "reduced" },
      { variantId: variants[2].id, problem: "sold_out" },
      { variantId: variants[4].id, problem: "unavailable" },
      { variantId: draft.variants[0].id, problem: "unavailable" },
      { variantId: foreign.variants[0].id, problem: "unavailable" }
    ]);
    expect({ pickupPolicy, refundPolicy, checkoutEnabled }).toEqual({ pickupPolicy: "EngSoc office", refundPolicy: "14 days", checkoutEnabled: false });
  });

  test("a quote holds ten lines at most, its version follows prices and quantities, and bad input is refused", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const { variants } = await product(organisation.id, user.id, Array.from({ length: 11 }, (_, index) => ({ size: `S${index}`, priceAmount: 500, remaining: 5 })));
    const items = variants.map((variant) => ({ variantId: variant.id, quantity: 1 }));
    const full = (await quote({ society: organisation.slug, items })).body.quote;
    expect(full.lines).toHaveLength(10);
    expect(full.problems).toEqual([{ variantId: variants[10].id, problem: "too_many_lines" }]);

    const one = { society: organisation.slug, items: [{ variantId: variants[0].id, quantity: 1 }] };
    const first = (await quote(one)).body.quote.version;
    expect((await quote(one)).body.quote.version).toBe(first);
    expect((await quote({ ...one, items: [{ variantId: variants[0].id, quantity: 2 }] })).body.quote.version).not.toBe(first);
    await prisma.merchandiseVariant.update({ where: { id: variants[0].id }, data: { priceAmount: 600 } });
    expect((await quote(one)).body.quote.version).not.toBe(first);

    expect((await quote({ society: "no-such-society", items: [] })).status).toBe(404);
    for (const bad of [{ society: organisation.slug }, { society: organisation.slug, items: [{ variantId: variants[0].id, quantity: 0 }] }, { society: organisation.slug, items: [], extra: 1 }]) {
      expect((await quote(bad)).status).toBe(400);
    }
  });
});
