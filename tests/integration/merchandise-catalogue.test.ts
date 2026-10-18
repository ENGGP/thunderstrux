import { describe, expect, test } from "vitest";
import { GET as listRoute, POST as createRoute } from "@/app/api/orgs/[orgSlug]/merchandise/route";
import { GET as readRoute, PATCH as updateRoute } from "@/app/api/orgs/[orgSlug]/merchandise/[productId]/route";
import { POST as publishRoute } from "@/app/api/orgs/[orgSlug]/merchandise/[productId]/publish/route";
import { POST as archiveRoute } from "@/app/api/orgs/[orgSlug]/merchandise/[productId]/archive/route";
import { POST as restoreRoute } from "@/app/api/orgs/[orgSlug]/merchandise/[productId]/restore/route";
import { assetPublicReferenced } from "@/lib/assets/references";
import { deleteAsset } from "@/lib/assets/service";
import { prisma } from "@/lib/db";
import { updateProfile } from "@/lib/organisations/profile";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { createMember, createOrganisationAccount, createOrganisationStaff, unique } from "@/tests/helpers/test-data";

const base = "http://localhost:3000/api/orgs";
const pickup = "EngSoc office, Level 2. Tuesdays and Thursdays, 12 to 2 pm.";

async function society({ stripeReady = false, pickupPolicy = pickup } = {}) {
  const account = await createOrganisationAccount({ stripeReady });
  await prisma.organisation.update({ where: { id: account.organisation.id }, data: { pickupPolicy } });
  setMockSession({ userId: account.user.id, email: account.user.email, accountRole: "organisation" });
  return account;
}

const photo = (organisationId: string, uploadedByUserId: string, data: { kind?: string; status?: string } = {}) =>
  prisma.asset.create({
    data: { organisationId, uploadedByUserId, storageKey: unique("assets/product"), kind: "product", status: "ready", readyAt: new Date(), byteSize: 10, width: 8, height: 10, sha256: "0".repeat(64), ...data }
  });

async function call(response: Promise<Response>) {
  const result = await response;
  return { status: result.status, body: await parseJsonResponse(result) };
}
const create = (slug: string, body: unknown) => call(createRoute(jsonRequest(`${base}/${slug}/merchandise`, body), routeContext({ orgSlug: slug })));
const update = (slug: string, productId: string, body: unknown) =>
  call(updateRoute(jsonRequest(`${base}/${slug}/merchandise/${productId}`, body, { method: "PATCH" }), routeContext({ orgSlug: slug, productId })));
const read = (slug: string, productId: string) => call(readRoute(jsonRequest(`${base}/${slug}/merchandise/${productId}`), routeContext({ orgSlug: slug, productId })));
const act = (route: typeof publishRoute, action: string) => (slug: string, productId: string, expectedVersion: number) =>
  call(route(jsonRequest(`${base}/${slug}/merchandise/${productId}/${action}`, { expectedVersion }), routeContext({ orgSlug: slug, productId })));
const publish = act(publishRoute, "publish");
const archive = act(archiveRoute, "archive");
const restore = act(restoreRoute, "restore");

const option = (colour: string, size: string, extra: Record<string, unknown> = {}) => ({ colour, size, sku: "", priceAmount: 4500, remaining: 5, ...extra });
const hoodie = (imageAssetIds: string[], variants = [option("Navy", "L"), option("Navy", "XL", { sku: "hood-xl" })]) => ({
  name: "EngSoc hoodie", description: "Heavyweight cotton blend.", imageAssetIds, variants
});

// What the editor sends back: each saved option with its version.
async function editorState(slug: string, productId: string) {
  const { body } = await read(slug, productId);
  const { name, description, imageAssetIds, variants, version } = body.product;
  return {
    name, description, imageAssetIds, expectedVersion: version as number,
    variants: (variants as Array<Record<string, unknown>>).map(({ id, version: optionVersion, colour, size, sku, priceAmount, remaining }) => ({ id, expectedVersion: optionVersion, colour, size, sku, priceAmount, remaining }))
  };
}

describe("merchandise catalogue", () => {
  test("a draft saves its photos and options, makes SKUs it isn't given, and refuses duplicate SKUs, duplicate options and bad values", async () => {
    const { user, organisation } = await society();
    const cover = await photo(organisation.id, user.id);
    const created = await create(organisation.slug, hoodie([cover.id]));
    expect(created.status).toBe(201);
    const product = created.body.product;
    expect(product).toMatchObject({ status: "draft", version: 1, name: "EngSoc hoodie" });
    const variants = await prisma.merchandiseVariant.findMany({ where: { productId: product.id }, orderBy: { position: "asc" } });
    expect(variants.map((variant) => variant.sku)).toEqual(["ENGSOC-HOODIE-NAVY-L", "HOOD-XL"]);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: cover.id } })).unreferencedAt).toBeNull();

    const clash = await create(organisation.slug, { ...hoodie([]), name: "Crew jumper", variants: [option("Grey", "M", { sku: "HOOD-XL" })] });
    expect(clash.status).toBe(400);
    expect(clash.body.error.details[0]).toMatchObject({ path: ["variants", "0", "sku"], message: expect.stringContaining("already used by EngSoc hoodie, Navy, XL") });
    // A generated SKU steps around one that is taken.
    const again = await create(organisation.slug, { ...hoodie([]), variants: [option("Navy", "L")] });
    expect(await prisma.merchandiseVariant.findFirstOrThrow({ where: { productId: again.body.product.id } })).toMatchObject({ sku: "ENGSOC-HOODIE-NAVY-L-2" });

    const duplicate = await create(organisation.slug, { ...hoodie([]), variants: [option("Navy", "L"), option("navy", "l")] });
    expect(duplicate).toMatchObject({ status: 400, body: { error: { details: [{ path: ["variants", "1", "size"], message: "This option is already in the list." }] } } });
    for (const bad of [option("Navy", "S", { sku: "HOOD S!" }), option("Navy", "S", { remaining: -1 }), option("Navy", "S", { priceAmount: 12.5 })]) {
      expect((await create(organisation.slug, { ...hoodie([]), variants: [bad] })).status).toBe(400);
    }
    expect((await create(organisation.slug, { ...hoodie([]), name: " " })).status).toBe(400);
    expect(await prisma.merchandiseProduct.count({ where: { organisationId: organisation.id } })).toBe(2);
  });

  test("photos must be ready product images of this society, at most four, and a used photo can't be deleted", async () => {
    const { user, organisation } = await society();
    const other = await createOrganisationAccount();
    const foreign = await photo(other.organisation.id, other.user.id);
    const eventImage = await photo(organisation.id, user.id, { kind: "event" });
    const pending = await photo(organisation.id, user.id, { status: "pending" });
    for (const id of [foreign.id, eventImage.id, pending.id]) {
      const refused = await create(organisation.slug, hoodie([id]));
      expect(refused).toMatchObject({ status: 400, body: { error: { details: [{ path: ["imageAssetIds"] }] } } });
    }
    const five = await Promise.all(Array.from({ length: 5 }, () => photo(organisation.id, user.id)));
    expect((await create(organisation.slug, hoodie(five.map((asset) => asset.id)))).status).toBe(400);

    const created = await create(organisation.slug, hoodie([five[0].id, five[1].id]));
    const storage = { put: async () => {}, get: async () => null, head: async () => false, delete: async () => {}, list: async () => ({ objects: [] }) };
    await expect(deleteAsset(user, organisation.id, five[0].id, storage)).rejects.toThrow("Remove this image from its profile, event or product");
    // Dropping a photo starts its cleanup delay.
    const state = await editorState(organisation.slug, created.body.product.id);
    expect((await update(organisation.slug, created.body.product.id, { ...state, imageAssetIds: [five[1].id] })).status).toBe(200);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: five[0].id } })).unreferencedAt).not.toBeNull();
    expect((await prisma.merchandiseProductImage.findMany({ where: { productId: created.body.product.id } })).map((image) => image.assetId)).toEqual([five[1].id]);
  });

  test("publishing needs a photo, an option buyers can get and pickup details; free options publish without payments", async () => {
    const { user, organisation } = await society({ pickupPolicy: "" });
    const cover = await photo(organisation.id, user.id);
    const draft = (await create(organisation.slug, { ...hoodie([]), variants: [] })).body.product;
    const blocked = await publish(organisation.slug, draft.id, 1);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details.map((detail: { reason: string }) => detail.reason)).toEqual(["photo_missing", "no_options", "pickup_missing"]);

    let state = await editorState(organisation.slug, draft.id);
    await update(organisation.slug, draft.id, { ...state, imageAssetIds: [cover.id], variants: [option("Navy", "L", { remaining: 0 })] });
    expect((await read(organisation.slug, draft.id)).body.blockers.map((blocker: { code: string }) => blocker.code)).toEqual(["no_stock", "pickup_missing"]);
    state = await editorState(organisation.slug, draft.id);
    await update(organisation.slug, draft.id, { ...state, variants: [{ ...state.variants[0], remaining: 5 }] });
    expect((await read(organisation.slug, draft.id)).body.blockers.map((blocker: { code: string }) => blocker.code)).toEqual(["payments_unavailable", "pickup_missing"]);

    await prisma.organisation.update({ where: { id: organisation.id }, data: { pickupPolicy: pickup } });
    state = await editorState(organisation.slug, draft.id);
    await update(organisation.slug, draft.id, { ...state, variants: [...state.variants, option("Sticker", "", { priceAmount: 0 })] });
    state = await editorState(organisation.slug, draft.id);
    const published = await publish(organisation.slug, draft.id, state.expectedVersion);
    expect(published).toMatchObject({ status: 200, body: { product: { status: "published" } } });
    expect(await prisma.$transaction((tx) => assetPublicReferenced(tx, cover.id))).toBe(true);
    expect((await publish(organisation.slug, draft.id, 1)).status).toBe(200);

    // On sale: stock may run out, but the photo and options must stay.
    state = await editorState(organisation.slug, draft.id);
    expect((await update(organisation.slug, draft.id, { ...state, variants: state.variants.map((variant) => ({ ...variant, remaining: 0 })) })).status).toBe(200);
    state = await editorState(organisation.slug, draft.id);
    const noPhoto = await update(organisation.slug, draft.id, { ...state, imageAssetIds: [] });
    expect(noPhoto).toMatchObject({ status: 409, body: { error: { details: [{ reason: "photo_missing" }] } } });

    // Buyers always have pickup details while something is on sale.
    const profile = await prisma.organisation.findUniqueOrThrow({ where: { id: organisation.id } });
    await expect(updateProfile(user, organisation.id, {
      expectedProfileVersion: profile.profileVersion, name: profile.name, description: profile.description, supportEmail: profile.supportEmail,
      refundPolicy: profile.refundPolicy, pickupPolicy: "", timeZone: profile.timeZone, logoAssetId: null, coverAssetId: null
    })).rejects.toThrow("buyers need pickup details");
  });

  test("options of a product once on sale stop selling instead of being removed, and stale versions are conflicts", async () => {
    const { user, organisation } = await society({ stripeReady: true });
    const cover = await photo(organisation.id, user.id);
    const created = (await create(organisation.slug, hoodie([cover.id], [option("Navy", "L"), option("Navy", "XL"), option("Grey", "M")]))).body.product;

    // A draft never on sale: a dropped option is deleted and frees its SKU.
    let state = await editorState(organisation.slug, created.id);
    const dropped = state.variants[2];
    await update(organisation.slug, created.id, { ...state, variants: [...state.variants.slice(0, 2), option("Grey", "S", { sku: dropped.sku })] });
    expect(await prisma.merchandiseVariant.count({ where: { productId: created.id } })).toBe(3);

    state = await editorState(organisation.slug, created.id);
    await publish(organisation.slug, created.id, state.expectedVersion);
    state = await editorState(organisation.slug, created.id);
    const stopped = state.variants[1];
    expect((await update(organisation.slug, created.id, { ...state, variants: [state.variants[0], state.variants[2]] })).status).toBe(200);
    expect(await prisma.merchandiseVariant.findUniqueOrThrow({ where: { id: stopped.id as string } })).toMatchObject({ archivedAt: expect.any(Date) });
    expect((await read(organisation.slug, created.id)).body).toMatchObject({ stoppedOptions: 1, product: { everPublished: true } });
    // Its SKU stays taken.
    state = await editorState(organisation.slug, created.id);
    const reuse = await update(organisation.slug, created.id, { ...state, variants: [...state.variants, option("Navy", "XXL", { sku: stopped.sku })] });
    expect(reuse.status).toBe(400);

    // A sale (or another editor) bumps an option's version: the save is refused, nothing changes.
    await prisma.merchandiseVariant.update({ where: { id: state.variants[0].id as string }, data: { remaining: 3, version: { increment: 1 } } });
    const stale = await update(organisation.slug, created.id, { ...state, variants: state.variants.map((variant) => ({ ...variant, remaining: 9 })) });
    expect(stale).toMatchObject({ status: 409, body: { error: { message: expect.stringContaining("changed since you opened this product") } } });
    expect((await prisma.merchandiseVariant.findUniqueOrThrow({ where: { id: state.variants[0].id as string } })).remaining).toBe(3);
    expect((await update(organisation.slug, created.id, { ...state, expectedVersion: state.expectedVersion - 1 })).status).toBe(409);
  });

  test("archive and restore; other societies and staff without merchandise:manage can't see or change products", async () => {
    const { user, organisation } = await society();
    const cover = await photo(organisation.id, user.id);
    const created = (await create(organisation.slug, hoodie([cover.id], [option("Tote", "", { priceAmount: 0 })]))).body.product;
    let state = await editorState(organisation.slug, created.id);
    await publish(organisation.slug, created.id, state.expectedVersion);
    state = await editorState(organisation.slug, created.id);
    const archived = await archive(organisation.slug, created.id, state.expectedVersion);
    expect(archived.body.product).toMatchObject({ status: "archived", publishedAt: null });
    expect(await prisma.$transaction((tx) => assetPublicReferenced(tx, cover.id))).toBe(false);
    expect((await update(organisation.slug, created.id, { ...state, expectedVersion: archived.body.product.version })).status).toBe(409);
    expect((await publish(organisation.slug, created.id, archived.body.product.version)).status).toBe(409);
    const restored = await restore(organisation.slug, created.id, archived.body.product.version);
    expect(restored.body.product).toMatchObject({ status: "draft", archivedAt: null });
    expect((await publish(organisation.slug, created.id, restored.body.product.version)).body.product.status).toBe("published");
    expect(await prisma.auditLog.count({ where: { targetId: created.id, action: { startsWith: "merchandise_product." } } })).toBe(5);

    // Another society: its own slug can't reach this product.
    const other = await society();
    expect((await read(other.organisation.slug, created.id)).status).toBe(404);
    // A member who isn't staff sees nothing; an event manager is told they lack access, as on other society routes.
    const list = () => call(listRoute(jsonRequest(`${base}/${organisation.slug}/merchandise`), routeContext({ orgSlug: organisation.slug })));
    const member = await createMember();
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    expect((await list()).status).toBe(404);
    const manager = await createMember();
    await createOrganisationStaff({ organisationId: organisation.id, userId: manager.id, role: "event_manager" });
    setMockSession({ userId: manager.id, email: manager.email, accountRole: "member" });
    expect((await list()).status).toBe(403);
    expect((await create(organisation.slug, hoodie([]))).status).toBe(403);
    expect(await prisma.merchandiseProduct.count({ where: { organisationId: organisation.id } })).toBe(1);
  });
});
