import { prisma } from "@/lib/db";
import { lockAccount } from "@/lib/auth/account-lock";
import { runDatabaseIntegrityAudit } from "@/lib/ops/integrity-audit";
import { ALL_WORKERS, scheduledWorkers } from "@/lib/ops/worker";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { PlatformRefusal, type PlatformActor } from "./authority";
import { platformWrite, type ChangeInput } from "./changes";

// T55: the portal's operations controls, the same writes as `pnpm ops:workers`
// and `pnpm db:integrity:audit`, and revoking an operator from the web.

export const workerNames: string[] = [ALL_WORKERS, ...scheduledWorkers];

export async function setWorkerPaused(actor: PlatformActor, worker: string, pause: boolean, input: ChangeInput, now = new Date()) {
  if (!workerNames.includes(worker)) throw new PlatformRefusal(`Name a job: ${workerNames.join(", ")}.`);
  return platformWrite(actor, "platform:operations", input, async (tx) => {
    const current = await tx.workerLease.findUnique({ where: { name: worker }, select: { pausedAt: true } });
    if (pause === Boolean(current?.pausedAt)) throw new PlatformRefusal(pause ? `${worker} is already paused.` : `${worker} isn't paused.`);
    // Like the CLI: the reason shows in the worker table, cut to its 200 characters.
    const data = pause ? { pausedAt: now, pauseReason: input.reason.replace(/\s+/g, " ").trim().slice(0, 200) } : { pausedAt: null, pauseReason: null };
    await tx.workerLease.upsert({ where: { name: worker }, create: { name: worker, ...data }, update: data });
    return { change: { action: pause ? "platform.worker_paused" : "platform.worker_resumed", targetType: "Worker", targetId: worker }, result: {} };
  }, now);
}

// Read-only checks, run only once the code is accepted, so a session without the
// phone can't start one. They read outside the transaction, which meanwhile holds
// only the operator's own row. Each check's count, class and sample ids are the
// trail's metadata, which the Operations page shows.
export async function runIntegrityAudit(actor: PlatformActor, input: ChangeInput, now = new Date()) {
  return platformWrite(actor, "platform:operations", input, async () => {
    const checks = (await runDatabaseIntegrityAudit()).map((check) => ({ name: check.name, classification: check.classification, count: check.count, legacy: Boolean(check.legacy), sampleIds: check.sampleIds.slice(0, 5) }));
    return { change: { action: "platform.integrity_audit_run", targetType: "IntegrityAudit", targetId: "database", metadata: { checks } }, result: { checks } };
  }, now, 120_000);
}

export function readPauseAll() {
  return prisma.workerLease.findUnique({ where: { name: ALL_WORKERS }, select: { pausedAt: true, pauseReason: true } });
}

export async function readLastIntegrityAudit() {
  const row = await prisma.platformAuditLog.findFirst({ where: { action: "platform.integrity_audit_run" }, orderBy: { createdAt: "desc" },
    select: { createdAt: true, metadata: true, actor: { select: { email: true, firstName: true, lastName: true, displayName: true } } } });
  if (!row) return null;
  const checks = ((row.metadata as { checks?: unknown } | null)?.checks ?? []) as Array<{ name: string; classification: string; count: number; legacy: boolean; sampleIds: string[] }>;
  return { at: row.createdAt, by: row.actor, checks };
}

// Q7: the web can only revoke, never itself and never the last active admin.
export async function revokeOperatorFromWeb(actor: PlatformActor, userId: string, input: ChangeInput, now = new Date()) {
  if (userId === actor.user.id) throw new PlatformRefusal("You can't revoke yourself. Another admin, or the CLI on the host, can.");
  const result = await platformWrite(actor, "platform:operators", input, async (tx) => {
    await lockAccount(tx, userId);
    const operator = await tx.platformOperator.findUnique({ where: { userId } });
    if (operator?.status !== "active") throw new PlatformRefusal("That account isn't an active operator.");
    // Locked, so two admins revoking each other can't both succeed.
    await tx.$queryRaw`SELECT "id" FROM "PlatformOperator" WHERE "status" = 'active' AND "role" = 'admin' FOR UPDATE`;
    if (operator.role === "admin" && (await tx.platformOperator.count({ where: { status: "active", role: "admin" } })) <= 1) {
      throw new PlatformRefusal("That's the last active admin. Grant another from the CLI first.");
    }
    await tx.platformOperator.update({ where: { userId }, data: { status: "revoked", revokedAt: now, revokedByUserId: actor.user.id } });
    return { change: { action: "platform.operator_revoked", targetType: "User", targetId: userId, metadata: { via: "web", role: operator.role } }, result: { role: operator.role } };
  }, now);
  emitOperationalAlert("platform_operator_changed", { action: "platform.operator_revoked", userId, role: result.role, via: "web" });
  return result;
}
