import { expect, onTestFinished, test, vi } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { sanitiseImage, readImageForm } from "@/lib/assets/image";
import { uploadAsset, deleteAsset, previewAsset } from "@/lib/assets/service";
import { maintainAssets } from "@/lib/assets/maintenance";
import type { AssetStorage } from "@/lib/assets/storage";
import { createOrganisationAccount, createMember } from "@/tests/helpers/test-data";
import { setMockSession } from "@/tests/helpers/auth";
import { createTestRateLimitBackend, setRateLimitTestBackend, setRateLimitTestEnabled, setRateLimitTestBackendFailure } from "@/lib/security/rate-limit";
import { POST } from "@/app/api/orgs/[orgSlug]/assets/route";
import { DELETE as deleteRoute, GET as previewRoute } from "@/app/api/orgs/[orgSlug]/assets/[assetId]/route";
import { GET as publicImage } from "@/app/api/public/assets/[assetId]/route";
import { jsonRequest } from "@/tests/helpers/http";

// The routes build their own storage; route tests hand them this one.
const routeStorage = vi.hoisted(() => ({ current: null as AssetStorage | null }));
vi.mock("@/lib/assets/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/assets/storage")>()),
  assetStorage: () => { if (!routeStorage.current) throw new Error("No test storage"); return routeStorage.current; }
}));

function memoryStorage() {
  const objects = new Map<string, Buffer>();
  const storage: AssetStorage = {
    put: async (key, bytes) => { objects.set(key, bytes); }, get: async key => objects.get(key) ?? null,
    head: async key => objects.has(key), delete: async key => { objects.delete(key); }, list: async () => ({ objects: [] })
  };
  return { storage, objects };
}
const png = () => sharp({ create: { width: 8, height: 6, channels: 4, background: "red" } }).png().toBuffer();

test("images are structurally checked, oriented/re-encoded and stripped of metadata", async () => {
  for (const format of ["png", "jpeg", "webp"] as const) {
    const source = await sharp(await png()).withMetadata().toFormat(format).toBuffer();
    const result = await sanitiseImage(source, `image/${format}`);
    expect(await sharp(result.bytes).metadata()).toMatchObject({ format: "webp", width: 8, height: 6 });
    expect((await sharp(result.bytes).metadata()).exif).toBeUndefined();
    await expect(sanitiseImage(Buffer.concat([source, Buffer.from("<html>bad</html>")]), `image/${format}`)).rejects.toThrow();
  }
  await expect(sanitiseImage(await png(), "image/jpeg")).rejects.toThrow();
  await expect(sanitiseImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), "image/svg+xml")).rejects.toThrow();
  await expect(sanitiseImage(Buffer.alloc(5 * 1024 * 1024 + 1), "image/png")).rejects.toThrow();
  const oversized = await sharp({ create: { width: 4097, height: 1, channels: 3, background: "red" } }).png().toBuffer();
  await expect(sanitiseImage(oversized, "image/png")).rejects.toThrow();
});
test("multipart reader bounds streamed bytes and accepts one file only", async () => {
  const form = new FormData(); form.set("file", new File([new Uint8Array(await png())], "test.png", { type: "image/png" }));
  expect((await readImageForm(new Request("http://localhost", { method: "POST", body: form }))).type).toBe("image/png");
  form.set("extra", "ignored");
  await expect(readImageForm(new Request("http://localhost", { method: "POST", body: form }))).rejects.toThrow();
  await expect(readImageForm(new Request("http://localhost", { method: "POST", body: Buffer.alloc(5 * 1024 * 1024 + 65537) }))).rejects.toThrow("too large");
});
test("upload, private preview and deletion preserve tenant boundaries and audit idempotency", async () => {
  const own = await createOrganisationAccount(); const other = await createOrganisationAccount();
  const { storage, objects } = memoryStorage();
  const asset = await uploadAsset(own.user, own.organisation.id, "logo", { bytes: await png(), type: "image/png" }, storage);
  expect(asset.status).toBe("ready"); expect(objects.size).toBe(1);
  expect((await publicImage(new Request(`http://localhost/api/public/assets/${asset.id}`), { params: Promise.resolve({ assetId: asset.id }) })).status).toBe(404);
  expect((await previewAsset(own.organisation.id, asset.id, storage)).bytes.length).toBeGreaterThan(0);
  await expect(deleteAsset(other.user, other.organisation.id, asset.id, storage)).rejects.toThrow("not found");
  await deleteAsset(own.user, own.organisation.id, asset.id, storage);
  await deleteAsset(own.user, own.organisation.id, asset.id, storage);
  expect(objects.size).toBe(0);
  // The upload and one deletion, however often it is repeated.
  expect((await prisma.auditLog.findMany({ where: { targetId: asset.id }, orderBy: { createdAt: "asc" } })).map((row) => [row.action, row.actorUserId, row.organisationId]))
    .toEqual([["asset.uploaded", own.user.id, own.organisation.id], ["asset.deleted", own.user.id, own.organisation.id]]);
});
test("failed provider work and revoked authority never make an image ready; delayed GC recovers bytes", async () => {
  const own = await createOrganisationAccount(); const { storage, objects } = memoryStorage();
  const originalPut = storage.put;
  storage.put = async (key, bytes) => {
    await originalPut(key, bytes);
    await prisma.organisationStaff.updateMany({ where: { userId: own.user.id }, data: { status: "revoked" } });
  };
  await expect(uploadAsset(own.user, own.organisation.id, "logo", { bytes: await png(), type: "image/png" }, storage)).rejects.toThrow();
  const failed = await prisma.asset.findFirstOrThrow(); expect(failed.status).toBe("failed");
  expect((await maintainAssets({ storage, dryRun: false })).eligible).toBe(0);
  await prisma.asset.update({ where: { id: failed.id }, data: { unreferencedAt: new Date(Date.now() - 25 * 3600000) } });
  expect((await maintainAssets({ storage })).eligible).toBe(1); expect(objects.size).toBe(1);
  expect(await prisma.auditLog.count({ where: { targetId: failed.id, action: "asset.orphan_removed" } })).toBe(0);
  expect((await maintainAssets({ storage, dryRun: false })).eligible).toBe(1); expect(objects.size).toBe(0);
  expect(await prisma.auditLog.findMany({ where: { targetId: failed.id, action: "asset.orphan_removed" } }))
    .toEqual([expect.objectContaining({ organisationId: own.organisation.id, actorUserId: null, metadata: { kind: "logo" } })]);
});
test("quota reservations serialize concurrent uploads and missing objects fail safely", async () => {
  const own = await createOrganisationAccount(); const { storage, objects } = memoryStorage();
  await prisma.asset.createMany({ data: Array.from({ length: 99 }, (_, index) => ({ organisationId: own.organisation.id, uploadedByUserId: own.user.id,
    storageKey: `assets/quota-${index}`, kind: "logo", byteSize: 1, width: 1, height: 1, sha256: "0".repeat(64) })) });
  const input = { bytes: await png(), type: "image/png" };
  const results = await Promise.allSettled([uploadAsset(own.user, own.organisation.id, "logo", input, storage), uploadAsset(own.user, own.organisation.id, "logo", input, storage)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(await prisma.asset.count()).toBe(100);
  const ready = await prisma.asset.findFirstOrThrow({ where: { status: "ready" } }); objects.clear();
  await expect(previewAsset(own.organisation.id, ready.id, storage)).rejects.toThrow("unavailable");
});
test("upload API denies ordinary members, foreign tenants, unsafe origin and unavailable required limits", async () => {
  const own = await createOrganisationAccount(); const member = await createMember();
  const context = { params: Promise.resolve({ orgSlug: own.organisation.slug }) };
  const request = () => jsonRequest(`http://localhost/api/orgs/${own.organisation.slug}/assets?kind=logo`, {});
  setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
  expect((await POST(request(), context)).status).toBe(404);
  setMockSession({ userId: own.user.id, email: own.user.email, accountRole: "organisation" });
  expect((await POST(jsonRequest("http://localhost/api/orgs/x/assets?kind=logo", {}, { headers: { origin: "https://evil.example" } }), context)).status).toBe(403);
  setRateLimitTestEnabled(true); setRateLimitTestBackendFailure(new Error("synthetic failure"));
  expect((await POST(request(), context)).status).toBe(503);
  vi.stubEnv("MFA_ENFORCEMENT_MODE", "enforce");
  vi.stubEnv("RATE_LIMIT_ENABLED", "true");
  vi.stubEnv("MFA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  expect((await POST(request(), context)).status).toBe(403);
});
test("provider failure, stale sessions and failed object deletion retain bounded recovery state", async () => {
  const own = await createOrganisationAccount(); const { storage } = memoryStorage();
  const input = { bytes: await png(), type: "image/png" };
  await expect(uploadAsset({ ...own.user, authVersion: 99 }, own.organisation.id, "logo", input, storage)).rejects.toThrow();
  expect(await prisma.asset.count()).toBe(0);
  const put = storage.put;
  storage.put = async () => { throw new Error("synthetic storage outage"); };
  await expect(uploadAsset(own.user, own.organisation.id, "logo", input, storage)).rejects.toThrow();
  expect((await prisma.asset.findFirstOrThrow()).status).toBe("failed");
  storage.put = put;
  const asset = await uploadAsset(own.user, own.organisation.id, "logo", input, storage);
  const remove = storage.delete;
  storage.delete = async () => { throw new Error("synthetic storage outage"); };
  await expect(deleteAsset(own.user, own.organisation.id, asset.id, storage)).rejects.toThrow();
  expect(await prisma.asset.findUnique({ where: { id: asset.id } })).toMatchObject({ status: "deleted", deletedAt: null });
  storage.delete = remove;
  await deleteAsset(own.user, own.organisation.id, asset.id, storage);
  expect(await prisma.auditLog.count({ where: { action: "asset.deleted", targetId: asset.id } })).toBe(1);
});
test("preview and delete routes sign in before revealing an image, stay inside the society, and delete only with abuse protection", async () => {
  const own = await createOrganisationAccount(); const other = await createOrganisationAccount();
  const { storage, objects } = memoryStorage();
  routeStorage.current = storage;
  setRateLimitTestBackendFailure(null);
  onTestFinished(() => { routeStorage.current = null; setRateLimitTestEnabled(null); setRateLimitTestBackend(null); });
  const asset = await uploadAsset(own.user, own.organisation.id, "logo", { bytes: await png(), type: "image/png" }, storage);
  const at = (orgSlug: string, assetId = asset.id) => ({ url: `http://localhost/api/orgs/${orgSlug}/assets/${assetId}`, context: { params: Promise.resolve({ orgSlug, assetId }) } });
  const preview = (orgSlug: string, assetId?: string) => { const { url, context } = at(orgSlug, assetId); return previewRoute(new Request(url), context); };
  const remove = (orgSlug: string) => { const { url, context } = at(orgSlug); return deleteRoute(jsonRequest(url, undefined, { method: "DELETE" }), context); };

  // Signed out, a real image and a made-up id look the same.
  expect((await preview(own.organisation.slug)).status).toBe(401);
  expect((await preview(own.organisation.slug, "missing")).status).toBe(401);

  setMockSession({ userId: own.user.id, email: own.user.email, accountRole: "organisation" });
  const shown = await preview(own.organisation.slug);
  expect(shown.status).toBe(200);
  expect(Object.fromEntries(["content-type", "x-content-type-options", "cache-control"].map((name) => [name, shown.headers.get(name)])))
    .toEqual({ "content-type": "image/webp", "x-content-type-options": "nosniff", "cache-control": "private, no-store" });
  expect((await preview(own.organisation.slug, "missing")).status).toBe(404);

  // Another society reaches it through neither its own address nor the owner's.
  setMockSession({ userId: other.user.id, email: other.user.email, accountRole: "organisation" });
  for (const slug of [own.organisation.slug, other.organisation.slug]) {
    expect((await preview(slug)).status).toBe(404);
    expect((await remove(slug)).status).toBe(404);
  }

  setMockSession({ userId: own.user.id, email: own.user.email, accountRole: "organisation" });
  setRateLimitTestEnabled(false);
  expect((await remove(own.organisation.slug)).status).toBe(503);
  expect(objects.size).toBe(1);
  setRateLimitTestEnabled(true); setRateLimitTestBackend(createTestRateLimitBackend());
  expect((await remove(own.organisation.slug)).status).toBe(200);
  expect(objects.size).toBe(0);
  expect((await preview(own.organisation.slug)).status).toBe(404);
});
