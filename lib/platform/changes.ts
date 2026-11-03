import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/app-url";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import type { NotificationTemplate } from "@/lib/email/templates";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import type { PlatformPermission } from "@/lib/permissions/platform";
import { lockPlatformActor, PlatformRefusal, type PlatformActor } from "./authority";

// T55: every change an operator makes runs through platformWrite. It needs the
// permission, a fresh authenticator code and a reason of 8 to 500 characters,
// and writes its PlatformAuditLog row in the same transaction as the change, so
// a refused change alters and records nothing. The platform_admin_action alert
// is the copy outside the database.

export type PlatformChange = {
  action: string;
  targetType: "User" | "Organisation" | "Recovery" | "Worker" | "IntegrityAudit";
  targetId: string;
  organisationId?: string | null;
  metadata?: Prisma.InputJsonObject;
};

export type ChangeInput = { reason: string; code: string };

export const cleanReason = (reason: string) => reason.replace(/\s+/g, " ").trim();

export async function platformWrite<T>(
  actor: PlatformActor,
  permission: PlatformPermission,
  input: ChangeInput,
  work: (tx: Prisma.TransactionClient, now: Date) => Promise<{ change: PlatformChange; result: T }>,
  now = new Date(),
  timeoutMs = 20_000
) {
  const reason = cleanReason(input.reason);
  if (reason.length < 8 || reason.length > 500) throw new PlatformRefusal("Give a reason of 8 to 500 characters.");
  const { change, result } = await prisma.$transaction(async (tx) => {
    const operator = await lockPlatformActor(tx, actor, permission, input.code, now);
    const done = await work(tx, now);
    await tx.platformAuditLog.create({ data: {
      actorUserId: operator.user.id, operatorRole: operator.role, action: done.change.action, targetType: done.change.targetType,
      targetId: done.change.targetId, organisationId: done.change.organisationId ?? null, reason, metadata: done.change.metadata
    } });
    return done;
  }, { timeout: timeoutMs });
  // Ids only; adminPathFor links the receiver to the record.
  emitOperationalAlert("platform_admin_action", {
    action: change.action, operatorUserId: actor.user.id, role: actor.role, targetType: change.targetType, targetId: change.targetId,
    ...(change.targetType === "User" ? { userId: change.targetId } : {}), ...(change.organisationId ? { organisationId: change.organisationId } : {})
  });
  return result;
}

export type Recipient = { email: string; userId?: string | null; relation: string };

// Notices to each person, sent by the notifications worker. A society notice
// (business) belongs to the society; the rest are personal (security). Empty and
// duplicate addresses are dropped.
export async function notifyPeople(tx: Prisma.TransactionClient, input: {
  eventKey: string; template: NotificationTemplate; message: string; recipients: Recipient[]; organisationId?: string; linkPath?: string;
}) {
  const link = input.linkPath ? new URL(input.linkPath, appUrl()).toString() : undefined;
  const seen = new Set<string>();
  for (const recipient of input.recipients) {
    const email = recipient.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    await enqueueNotification(tx, {
      eventKey: input.eventKey, recipient: email, template: input.template, userId: recipient.userId ?? undefined,
      organisationId: input.organisationId, payload: { message: input.message, ...(link ? { link } : {}) }
    });
  }
  return [...seen];
}

// Society History rows for support's changes: no person as actor, so History
// shows "Thunderstrux support" and never the operator (lib/audit/history.ts).
export function societyHistory(tx: Prisma.TransactionClient, rows: Array<{ organisationId: string; action: string; targetType: string; targetId: string; metadata?: Prisma.InputJsonObject }>) {
  return rows.length ? tx.auditLog.createMany({ data: rows.map((row) => ({ ...row, actorUserId: null })) }) : null;
}
