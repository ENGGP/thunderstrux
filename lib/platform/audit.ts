import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { PlatformActor } from "./authority";

// T54: every record an operator opens and every search they run leaves a row
// (Q8). A search keeps only a digest of what was typed, never the text, so
// buyer emails never land in the trail; an investigator hashes a candidate to
// check it. Both kinds are pruned after two years (lib/security/token-cleanup.ts).
export const accessRetentionMs = 2 * 365 * 24 * 60 * 60 * 1000;
export const accessActions = ["platform.viewed", "platform.searched"];

export const searchDigest = (query: string) =>
  createHash("sha256").update(`platform-search:v1:${query.trim().toLowerCase()}`).digest("hex");

export type PlatformTarget = { type: "User" | "Organisation" | "Order" | "CommerceOrder" | "Event"; id: string; organisationId?: string | null };

export async function recordPlatformView(actor: PlatformActor, target: PlatformTarget) {
  await prisma.platformAuditLog.create({ data: {
    actorUserId: actor.user.id, operatorRole: actor.role, action: "platform.viewed",
    targetType: target.type, targetId: target.id, organisationId: target.organisationId ?? null
  } });
}

export async function recordPlatformSearch(actor: PlatformActor, query: string, results: number) {
  await prisma.platformAuditLog.create({ data: {
    actorUserId: actor.user.id, operatorRole: actor.role, action: "platform.searched",
    targetType: "Search", metadata: { queryDigest: searchDigest(query), results }
  } });
}

export type PlatformAuditFilters = { actorUserId?: string; action?: string; targetId?: string };

// Newest first, 50 a page; the cursor is the last row's time and id.
export async function readPlatformAudit(filters: PlatformAuditFilters, cursor?: { createdAt: Date; id: string }) {
  const where: Prisma.PlatformAuditLogWhereInput = {
    ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.targetId ? { targetId: filters.targetId } : {}),
    ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {})
  };
  const rows = await prisma.platformAuditLog.findMany({
    where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51,
    select: { id: true, action: true, targetType: true, targetId: true, organisationId: true, reason: true, metadata: true, operatorRole: true, createdAt: true,
      actor: { select: { id: true, email: true, firstName: true, lastName: true, displayName: true } } }
  });
  return { rows: rows.slice(0, 50), next: rows.length > 50 ? { createdAt: rows[49].createdAt, id: rows[49].id } : null };
}
