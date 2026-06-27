import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function writeAuditLog({
  organisationId,
  actorUserId,
  action,
  targetType,
  targetId,
  metadata
}: {
  organisationId: string;
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.auditLog.create({
    data: {
      organisationId,
      actorUserId: actorUserId ?? null,
      action,
      targetType,
      targetId: targetId ?? null,
      metadata
    }
  });
}
