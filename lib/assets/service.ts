import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { AccountActor } from "@/lib/auth/account-lifecycle";
import type { OrganisationPermission } from "@/lib/permissions";
import { activeEntitlementGrant } from "@/lib/memberships/grants";
import { lockOrganisationActor } from "@/lib/organisations/authority";
import { AssetError, sanitiseImage } from "./image";
import { assetStorage, type AssetStorage } from "./storage";
import { assetPublicReferenced, assetReferenced } from "./references";

export const assetKinds = ["logo", "cover", "event", "product"] as const;
export type AssetKind = typeof assetKinds[number];
export function assetPermission(kind: AssetKind): OrganisationPermission {
  return kind === "event" ? "events:manage" : kind === "product" ? "merchandise:manage" : "organisation:settings";
}
export const assetSelect = { id: true, kind: true, contentType: true, byteSize: true, width: true, height: true, sha256: true, status: true } as const;
async function lockAsset(tx: Prisma.TransactionClient, organisationId: string, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Asset" WHERE "id" = ${id} AND "organisationId" = ${organisationId} FOR UPDATE`;
  const asset = await tx.asset.findFirst({ where: { id, organisationId } });
  if (!asset) throw new AssetError(404, "Image was not found");
  return asset;
}
export async function uploadAsset(actor: AccountActor, organisationId: string, kind: AssetKind, input: { bytes: Buffer; type: string }, storage: AssetStorage = assetStorage()) {
  const image = await sanitiseImage(input.bytes, input.type);
  const permission = assetPermission(kind);
  const asset = await prisma.$transaction(async tx => {
    await lockOrganisationActor(tx, actor, organisationId, permission);
    const quota = await tx.asset.aggregate({ where: { organisationId, deletedAt: null }, _count: true, _sum: { byteSize: true } });
    if (quota._count >= 100 || (quota._sum.byteSize ?? 0) + image.byteSize > 250 * 1024 * 1024)
      throw new AssetError(429, "Society image storage quota reached. Remove unused images first.");
    return tx.asset.create({ data: { organisationId, uploadedByUserId: actor.id, storageKey: `assets/${randomUUID()}.webp`, kind,
      byteSize: image.byteSize, width: image.width, height: image.height, sha256: image.sha256 } });
  });
  try {
    await storage.put(asset.storageKey, image.bytes);
    if (!await storage.head(asset.storageKey)) throw new AssetError(503, "Image storage could not be verified");
    return await prisma.$transaction(async tx => {
      await lockOrganisationActor(tx, actor, organisationId, permission);
      const current = await lockAsset(tx, organisationId, asset.id);
      if (current.status !== "pending") throw new AssetError(409, "Image upload is no longer pending");
      const ready = await tx.asset.update({ where: { id: asset.id }, data: { status: "ready", readyAt: new Date() }, select: assetSelect });
      await tx.auditLog.create({ data: { organisationId, actorUserId: actor.id, action: "asset.uploaded", targetType: "Asset", targetId: asset.id,
        metadata: { kind, byteSize: image.byteSize, width: image.width, height: image.height, sha256: image.sha256 } } });
      return ready;
    });
  } catch (error) {
    // Keep the reserved key durable even if recovery itself fails; GC can retry it.
    await prisma.asset.updateMany({ where: { id: asset.id, status: "pending" }, data: { status: "failed" } });
    throw error;
  }
}
export async function deleteAsset(actor: AccountActor, organisationId: string, id: string, storage: AssetStorage = assetStorage()) {
  const asset = await prisma.$transaction(async tx => {
    const snapshot = await tx.asset.findFirst({ where: { id, organisationId } });
    if (!snapshot) throw new AssetError(404, "Image was not found");
    await lockOrganisationActor(tx, actor, organisationId, assetPermission(snapshot.kind as AssetKind));
    const current = await lockAsset(tx, organisationId, id);
    if (await assetReferenced(tx, id)) throw new AssetError(409, "Remove this image from its profile, event or product before deleting it");
    if (current.status === "pending") throw new AssetError(409, "Image is still uploading");
    if (current.status !== "deleted") {
      await tx.asset.update({ where: { id }, data: { status: "deleted" } });
      await tx.auditLog.create({ data: { organisationId, actorUserId: actor.id, action: "asset.deleted", targetType: "Asset", targetId: id, metadata: { kind: current.kind } } });
    }
    return current;
  });
  if (!asset.deletedAt) {
    await storage.delete(asset.storageKey);
    await prisma.asset.update({ where: { id }, data: { deletedAt: new Date() } });
  }
  return { deleted: true };
}
export async function previewAsset(organisationId: string, id: string, storage: AssetStorage = assetStorage()) {
  const asset = await prisma.asset.findFirst({ where: { id, organisationId, status: "ready" } });
  if (!asset) throw new AssetError(404, "Image was not found");
  return { asset, bytes: await assetBytes(asset, storage) };
}
// A ready image's bytes, checked against its row.
export async function assetBytes(asset: { storageKey: string; byteSize: number; sha256: string }, storage: AssetStorage = assetStorage()) {
  const bytes = await storage.get(asset.storageKey);
  if (!bytes || bytes.length !== asset.byteSize || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new AssetError(404, "Image is unavailable");
  return bytes;
}
export async function assetKindForSlug(orgSlug: string, id: string) {
  return (await prisma.asset.findFirst({ where: { id, organisation: { slug: orgSlug } }, select: { kind: true } }))?.kind as AssetKind | undefined;
}
// A ready image that a public profile currently references; null conceals everything else.
// Callers read the bytes with assetBytes only when they send them (SEC-021).
export async function publicAsset(id: string) {
  const asset = await prisma.asset.findUnique({ where: { id } });
  if (!asset || asset.status !== "ready" || !await prisma.$transaction(tx => assetPublicReferenced(tx, id))) return null;
  return asset;
}
// The image of a published members-only event, for a verified member whose
// live membership of that society unlocks members-only events (T24b); the
// route serves it privately and uncached.
export async function memberEventAsset(id: string, userId: string, now = new Date()) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { accountRole: true, emailVerifiedAt: true } });
  if (user?.accountRole !== "member" || !user.emailVerifiedAt) return null;
  const events = await prisma.event.findMany({ where: { heroAssetId: id, status: "published", visibility: "members_only" }, select: { organisationId: true } });
  for (const organisationId of new Set(events.map((event) => event.organisationId))) {
    if (await activeEntitlementGrant(prisma, userId, organisationId, "members_only_events", now)) return prisma.asset.findFirst({ where: { id, organisationId, status: "ready" } });
  }
  return null;
}
