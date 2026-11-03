import type { PlatformOperatorRole, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { lockAccount } from "@/lib/auth/account-lock";
import { emitOperationalAlert } from "@/lib/ops/alerts";

// Database-only (the CLI, invite acceptance and the portal all use it): no
// HTTP auth, session or CSRF modules.

type AuthorityClient = Pick<Prisma.TransactionClient, "platformOperator">;

// The one platform authority rule: an active operator row on an account that
// isn't disabled. Read live on every request, like liveStaffRole.
export async function livePlatformRole(db: AuthorityClient, user: { id: string; disabledAt?: Date | null }): Promise<PlatformOperatorRole | null> {
  if (user.disabledAt) return null;
  const row = await db.platformOperator.findUnique({ where: { userId: user.id }, select: { role: true, status: true } });
  return row?.status === "active" ? row.role : null;
}

export class PlatformOperatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformOperatorError";
  }
}

const roles: PlatformOperatorRole[] = ["support", "admin"];
const clean = (text: string | undefined) => text?.replace(/\s+/g, " ").trim() ?? "";

// Q1: an operator is a dedicated login. One that runs a society (or is the
// legacy society login) would carry society power and platform power together.
async function assertDedicatedAccount(tx: Prisma.TransactionClient, email: string) {
  const user = await tx.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
  if (!user) throw new PlatformOperatorError(`No account uses ${email}. Sign up with it first.`);
  const live = await lockAccount(tx, user.id);
  if (!live || live.closedAt || live.disabledAt) throw new PlatformOperatorError(`${email} is closed or disabled.`);
  if (!live.emailVerifiedAt) throw new PlatformOperatorError(`${email} isn't verified yet. Verify the email first.`);
  if (live.accountRole !== "member") throw new PlatformOperatorError(`${email} is a society login. Operators use a dedicated member account.`);
  const [staff, legacy] = await Promise.all([
    tx.organisationStaff.count({ where: { userId: user.id, status: "active" } }),
    tx.organisation.count({ where: { accountUserId: user.id } })
  ]);
  if (staff || legacy) throw new PlatformOperatorError(`${email} is staff of ${staff + legacy} ${staff + legacy === 1 ? "society" : "societies"}. Operators use a dedicated account with no society roles.`);
  return live;
}

// CLI only (Q7): granting needs host access, so a stolen web session can never mint an operator.
export async function grantPlatformOperator(input: { email: string; role: string; note?: string; by: string }, now = new Date()) {
  if (!roles.includes(input.role as PlatformOperatorRole)) throw new PlatformOperatorError(`--role must be ${roles.join(" or ")}`);
  const role = input.role as PlatformOperatorRole;
  const note = clean(input.note);
  if (note.length < 8 || note.length > 500) throw new PlatformOperatorError("--note must be 8 to 500 characters: why this person gets access");
  const result = await prisma.$transaction(async (tx) => {
    const user = await assertDedicatedAccount(tx, input.email);
    const existing = await tx.platformOperator.findUnique({ where: { userId: user.id } });
    if (existing?.status === "active" && existing.role === role) return { userId: user.id, email: user.email, role, changed: false as const };
    const action = existing?.status === "active" ? "platform.operator_role_changed" : "platform.operator_granted";
    await tx.platformOperator.upsert({
      where: { userId: user.id },
      create: { userId: user.id, role, grantedBy: input.by, note },
      update: { role, status: "active", grantedAt: now, grantedBy: input.by, note, revokedAt: null, revokedByUserId: null }
    });
    await tx.platformAuditLog.create({ data: {
      action, targetType: "User", targetId: user.id, operatorRole: role, reason: note,
      metadata: { via: "cli", by: input.by, ...(existing?.status === "active" ? { from: existing.role } : {}) }
    } });
    return { userId: user.id, email: user.email, role, changed: true as const, action };
  });
  if (result.changed) emitOperationalAlert("platform_operator_changed", { action: result.action, userId: result.userId, role, via: "cli" });
  return result;
}

export async function revokePlatformOperator(input: { email: string; reason?: string; by: string }, now = new Date()) {
  const reason = clean(input.reason);
  if (reason.length < 8 || reason.length > 500) throw new PlatformOperatorError("--reason must be 8 to 500 characters");
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { email: input.email.trim().toLowerCase() }, select: { id: true } });
    const existing = user ? await tx.platformOperator.findUnique({ where: { userId: user.id } }) : null;
    if (!user || existing?.status !== "active") throw new PlatformOperatorError(`${input.email} isn't an active operator.`);
    await lockAccount(tx, user.id);
    await tx.platformOperator.update({ where: { userId: user.id }, data: { status: "revoked", revokedAt: now } });
    await tx.platformAuditLog.create({ data: {
      action: "platform.operator_revoked", targetType: "User", targetId: user.id, operatorRole: existing.role, reason,
      metadata: { via: "cli", by: input.by }
    } });
    return { userId: user.id, role: existing.role };
  });
  emitOperationalAlert("platform_operator_changed", { action: "platform.operator_revoked", userId: result.userId, role: result.role, via: "cli" });
  return result;
}

export function listPlatformOperators() {
  return prisma.platformOperator.findMany({
    orderBy: [{ status: "asc" }, { grantedAt: "asc" }],
    select: { id: true, role: true, status: true, grantedAt: true, grantedBy: true, note: true, revokedAt: true,
      user: { select: { id: true, email: true, firstName: true, lastName: true, displayName: true, lastSignInAt: true, mfa: { select: { enabledAt: true } } } } }
  });
}
