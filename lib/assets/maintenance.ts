import { prisma } from "@/lib/db";
import { assetReferenced } from "./references";
import { createHash } from "node:crypto";
import { assetStorage, type AssetStorage } from "./storage";

export async function maintainAssets({ dryRun = true, storage = assetStorage(), now = new Date(), cursor }: { dryRun?: boolean; storage?: AssetStorage; now?: Date; cursor?: string } = {}) {
  const cutoff = new Date(now.getTime() - 24 * 3600000);
  const candidates = await prisma.asset.findMany({ where: { deletedAt: null, OR: [
    { status: "deleted" }, { unreferencedAt: { lte: cutoff } }
  ] }, orderBy: { id: "asc" }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
  let eligible = 0;
  for (const candidate of candidates) {
    const key = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${candidate.organisationId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Asset" WHERE "id" = ${candidate.id} FOR UPDATE`;
      const asset = await tx.asset.findUnique({ where: { id: candidate.id } });
      if (!asset || asset.deletedAt || await assetReferenced(tx, asset.id) ||
        (asset.status !== "deleted" && (!asset.unreferencedAt || asset.unreferencedAt > cutoff))) return null;
      if (!dryRun && asset.status !== "deleted") {
        await tx.asset.update({ where: { id: asset.id }, data: { status: "deleted" } });
        await tx.auditLog.create({ data: { organisationId: asset.organisationId, action: "asset.orphan_removed", targetType: "Asset", targetId: asset.id, metadata: { kind: asset.kind } } });
      }
      return asset.storageKey;
    });
    if (!key) continue;
    eligible++;
    if (!dryRun) {
      await storage.delete(key);
      await prisma.asset.update({ where: { id: candidate.id }, data: { deletedAt: now } });
    }
  }
  return { scanned: candidates.length, eligible, dryRun, nextCursor: candidates.length === 100 ? candidates.at(-1)!.id : null };
}
export async function inspectAssetObjects(storage: AssetStorage = assetStorage(), cursor?: string) {
  const page = await storage.list(cursor);
  let missingMetadata = 0;
  for (const object of page.objects) {
    if (!await prisma.asset.findUnique({ where: { storageKey: object.key }, select: { id: true } })) missingMetadata++;
  }
  return { scanned: page.objects.length, missingMetadata, nextCursor: page.cursor ?? null };
}
export async function inspectAssets(storage: AssetStorage = assetStorage(), cursor?: string) {
  const assets = await prisma.asset.findMany({ where: { status: "ready" }, orderBy: { id: "asc" }, take: 100,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
  let missingOrCorrupt = 0;
  for (const asset of assets) {
    const bytes = await storage.get(asset.storageKey);
    if (!bytes || bytes.length !== asset.byteSize || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) missingOrCorrupt++;
  }
  return { scanned: assets.length, missingOrCorrupt, nextCursor: assets.length === 100 ? assets.at(-1)!.id : null };
}
