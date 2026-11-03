import type { PlatformRecoveryKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { lockAccount } from "@/lib/auth/account-lock";
import { formatDateTime } from "@/lib/format";
import { PlatformRefusal, type PlatformActor } from "./authority";
import { notifyPeople, platformWrite, societyHistory, type ChangeInput, type Recipient } from "./changes";
import { livePlatformRole } from "./operators";
import { lockSociety, societySelect } from "./societies";

// T55: takeover-class recovery (Q4). An authenticator reset or an ownership
// recovery is requested, everyone affected is told, and an operator completes
// it only 72 hours later; anyone who objects writes to support and it is
// cancelled. Completion rechecks everything under locks, because the target can
// change in those 72 hours and a restore can bring an old request back.
// An ownership change also holds payouts for 7 days.

export const recoveryDelayMs = 72 * 60 * 60_000;
export const ownershipPayoutHoldMs = 7 * 24 * 60 * 60_000;
const changed = "This request can't be completed: the account or society changed since it was made. Cancel it and start a new one if it's still needed.";
const name = (user: { displayName: string | null; firstName: string | null; lastName: string | null; email: string }) =>
  user.displayName || [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
const requestedKey = (id: string) => `platform-recovery/${id}/requested`;

// Who may receive recovered access: an existing, verified, enabled member account
// that isn't an operator, so support never invents an identity.
async function eligibleTarget(tx: Prisma.TransactionClient, userId: string) {
  const user = await lockAccount(tx, userId);
  if (!user || user.closedAt || user.disabledAt || !user.emailVerifiedAt || (await livePlatformRole(tx, user))) return null;
  return user;
}

// Everyone an MFA reset tells: the person, and when they own a society, its other owners and admins.
async function mfaResetRecipients(tx: Prisma.TransactionClient, user: { id: string; email: string }): Promise<Recipient[]> {
  const owned = await tx.organisationStaff.findMany({ where: { userId: user.id, status: "active", role: "owner" }, select: { organisationId: true } });
  const colleagues = owned.length ? await tx.organisationStaff.findMany({
    where: { organisationId: { in: owned.map((row) => row.organisationId) }, status: "active", role: { in: ["owner", "admin"] }, userId: { not: user.id }, user: { disabledAt: null } },
    select: { role: true, user: { select: { id: true, email: true } } }
  }) : [];
  return [{ email: user.email, userId: user.id, relation: "account holder" }, ...colleagues.map((row) => ({ email: row.user.email, userId: row.user.id, relation: row.role }))];
}

// Everyone an ownership recovery tells: every active staff member, the society's contact address, and the new owner.
function ownershipRecipients(society: Prisma.OrganisationGetPayload<{ select: typeof societySelect }>, user: { id: string; email: string }): Recipient[] {
  return [
    ...society.staff.filter((row) => !row.user.disabledAt).map((row) => ({ email: row.user.email, userId: row.user.id, relation: row.role })),
    ...(society.supportEmail ? [{ email: society.supportEmail, relation: "society contact address" }] : []),
    { email: user.email, userId: user.id, relation: "new owner" }
  ];
}

// Who a request would tell, for the wizard's review step.
export async function previewRecipients(kind: PlatformRecoveryKind, userId: string, organisationId?: string) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!user) return [];
    if (kind === "mfa_reset") return mfaResetRecipients(tx, user);
    const society = await tx.organisation.findUnique({ where: { id: organisationId }, select: societySelect });
    return society ? ownershipRecipients(society, user) : [];
  });
}

export type RecoveryRequestInput = ChangeInput & { kind: PlatformRecoveryKind; userId: string; organisationId?: string; evidence: string };

export async function requestRecovery(actor: PlatformActor, input: RecoveryRequestInput, now = new Date()) {
  const evidence = input.evidence.replace(/[ \t]+/g, " ").trim();
  if (evidence.length < 8 || evidence.length > 1000) throw new PlatformRefusal("Record what you checked, in 8 to 1000 characters.");
  if (input.userId === actor.user.id) throw new PlatformRefusal("You can't recover your own account.");
  try {
    return await platformWrite(actor, "platform:recovery", input, async (tx) => {
      const user = await eligibleTarget(tx, input.userId);
      if (!user) throw new PlatformRefusal("Only an existing, verified, enabled account that isn't an operator can be recovered.");
      const executeAfter = new Date(now.getTime() + recoveryDelayMs);
      if (input.kind === "mfa_reset") {
        if (!(await tx.userMfa.findUnique({ where: { userId: user.id }, select: { enabledAt: true } }))?.enabledAt) throw new PlatformRefusal("This account has no authenticator to reset.");
        const request = await tx.platformRecoveryRequest.create({ data: { kind: "mfa_reset", targetUserId: user.id, requestedByUserId: actor.user.id, reason: input.reason.trim(), evidence, executeAfter } });
        await tx.accountSecurityEvent.create({ data: { userId: user.id, type: "support_mfa_reset_requested", authVersion: user.authVersion, createdAt: now } });
        const told = await notifyPeople(tx, { eventKey: requestedKey(request.id), template: "mfa_reset_requested", recipients: await mfaResetRecipients(tx, user),
          message: `Thunderstrux support was asked to reset the authenticator on ${user.email}. It can happen after ${formatDateTime(executeAfter)}, Brisbane time. If you didn't ask for this, reply to support before then and it will be cancelled.` });
        return { change: { action: "platform.mfa_reset_requested", targetType: "Recovery" as const, targetId: request.id, metadata: { userId: user.id, told: told.length, executeAfter: executeAfter.toISOString() } }, result: { requestId: request.id } };
      }
      const society = await lockSociety(tx, input.organisationId ?? "");
      if (society.staff.some((row) => row.role === "owner" && row.user.id === user.id)) throw new PlatformRefusal(`${name(user)} is already an owner of ${society.name}.`);
      const owners = await tx.organisationStaff.findMany({ where: { organisationId: society.id, role: "owner", status: "active" }, select: { user: { select: { id: true, lastSignInAt: true } } } });
      const request = await tx.platformRecoveryRequest.create({ data: { kind: "ownership", targetUserId: user.id, organisationId: society.id, requestedByUserId: actor.user.id, reason: input.reason.trim(), evidence, executeAfter } });
      await societyHistory(tx, [{ organisationId: society.id, action: "platform.ownership_recovery_requested", targetType: "User", targetId: user.id, metadata: { name: name(user), executeAfter: executeAfter.toISOString() } }]);
      const told = await notifyPeople(tx, { eventKey: requestedKey(request.id), template: "ownership_recovery_requested", recipients: ownershipRecipients(society, user),
        message: `Thunderstrux support was asked to make ${name(user)} (${user.email}) an owner of ${society.name}. It can happen after ${formatDateTime(executeAfter)}, Brisbane time; payouts then wait 7 days. If this is wrong, reply to support before then and it will be cancelled.` });
      return { change: { action: "platform.ownership_recovery_requested", targetType: "Recovery" as const, targetId: request.id, organisationId: society.id,
        metadata: { userId: user.id, told: told.length, executeAfter: executeAfter.toISOString(), ownersLastSignIn: owners.map((row) => ({ userId: row.user.id, at: row.user.lastSignInAt?.toISOString() ?? null })) } }, result: { requestId: request.id } };
    }, now);
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "P2002") throw new PlatformRefusal(input.kind === "mfa_reset" ? "An authenticator reset is already open for this account." : "An ownership recovery is already open for this society.");
    throw error;
  }
}

// The people a request told, for the notices that follow it and the request page.
async function told(tx: Prisma.TransactionClient | typeof prisma, requestId: string) {
  return tx.notificationOutbox.findMany({ where: { eventKey: requestedKey(requestId) }, orderBy: { createdAt: "asc" }, select: { recipient: true, userId: true, status: true, acceptedAt: true } });
}

// The request, locked in the order every change takes: its target account, then its society, then the request.
async function lockRequest(tx: Prisma.TransactionClient, requestId: string) {
  const head = await tx.platformRecoveryRequest.findUnique({ where: { id: requestId }, select: { targetUserId: true, organisationId: true } });
  if (!head) throw new PlatformRefusal("That request doesn't exist.");
  const user = await eligibleTarget(tx, head.targetUserId);
  const society = head.organisationId ? await lockSociety(tx, head.organisationId) : null;
  await tx.$queryRaw`SELECT "id" FROM "PlatformRecoveryRequest" WHERE "id" = ${requestId} FOR UPDATE`;
  const request = await tx.platformRecoveryRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (request.status !== "pending") throw new PlatformRefusal(`This request is already ${request.status}.`);
  return { request, user, society };
}

export async function completeRecovery(actor: PlatformActor, requestId: string, input: ChangeInput, now = new Date()) {
  return platformWrite(actor, "platform:recovery", input, async (tx) => {
    const { request, user, society } = await lockRequest(tx, requestId);
    if (now < request.executeAfter) throw new PlatformRefusal(`Not ready yet: it can be completed from ${formatDateTime(request.executeAfter)}, Brisbane time.`);
    if (!user) throw new PlatformRefusal(changed);
    const recipients = (await told(tx, request.id)).map((row) => ({ email: row.recipient, userId: row.userId, relation: "told" }));
    const base = { targetType: "Recovery" as const, targetId: request.id };
    const complete = () => tx.platformRecoveryRequest.update({ where: { id: request.id }, data: { status: "completed", completedAt: now } });
    if (request.kind === "mfa_reset") {
      if (!(await tx.userMfa.findUnique({ where: { userId: user.id }, select: { enabledAt: true } }))?.enabledAt) throw new PlatformRefusal(changed);
      await complete();
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.mfaGrant.deleteMany({ where: { userId: user.id } });
      await tx.userMfa.delete({ where: { userId: user.id } });
      const updated = await tx.user.update({ where: { id: user.id }, data: { authVersion: { increment: 1 } } });
      await tx.accountSecurityEvent.create({ data: { userId: user.id, type: "support_mfa_reset_completed", authVersion: updated.authVersion, createdAt: now } });
      await notifyPeople(tx, { eventKey: `platform-recovery/${request.id}/completed`, template: "mfa_reset_completed", recipients, linkPath: "/login",
        message: `Thunderstrux support reset the authenticator on ${user.email} and signed it out everywhere. Sign in and set up a new authenticator.` });
      return { change: { action: "platform.mfa_reset_completed", ...base, metadata: { userId: user.id } }, result: {} };
    }
    if (!society || society.staff.some((row) => row.role === "owner" && row.user.id === user.id)) throw new PlatformRefusal(changed);
    await complete();
    await tx.organisationStaff.upsert({
      where: { organisationId_userId: { organisationId: society.id, userId: user.id } },
      create: { organisationId: society.id, userId: user.id, role: "owner", acceptedAt: now },
      update: { role: "owner", status: "active", acceptedAt: now, revokedAt: null, revokedById: null }
    });
    // An open-ended hold stays open-ended; otherwise payouts wait at least 7 days.
    const holdEnd = new Date(now.getTime() + ownershipPayoutHoldMs);
    const keepOpen = society.payoutsHeldAt && !society.payoutsHeldUntil;
    const until = keepOpen ? null : society.payoutsHeldUntil && society.payoutsHeldUntil > holdEnd ? society.payoutsHeldUntil : holdEnd;
    await tx.organisation.update({ where: { id: society.id }, data: { payoutsHeldAt: society.payoutsHeldAt ?? now, payoutsHeldUntil: until, ...(keepOpen ? {} : { payoutsHeldReason: "Ownership recovered: payouts wait 7 days" }) } });
    await societyHistory(tx, [{ organisationId: society.id, action: "platform.ownership_recovered", targetType: "User", targetId: user.id, metadata: { name: name(user), ...(until ? { payoutsHeldUntil: until.toISOString() } : {}) } }]);
    await notifyPeople(tx, { eventKey: `platform-recovery/${request.id}/completed`, template: "ownership_recovered", recipients,
      message: `Thunderstrux support made ${name(user)} (${user.email}) an owner of ${society.name}. Nobody else's role changed.${until ? ` Payouts wait until ${formatDateTime(until)}, Brisbane time.` : ""}` });
    return { change: { action: "platform.ownership_recovered", ...base, organisationId: society.id, metadata: { userId: user.id, payoutsHeldUntil: until?.toISOString() ?? null } }, result: {} };
  }, now);
}

export async function cancelRecovery(actor: PlatformActor, requestId: string, input: ChangeInput, now = new Date()) {
  return platformWrite(actor, "platform:recovery", input, async (tx) => {
    const head = await tx.platformRecoveryRequest.findUnique({ where: { id: requestId }, select: { targetUserId: true, organisationId: true } });
    if (!head) throw new PlatformRefusal("That request doesn't exist.");
    // Cancelling never needs the target to be eligible: it takes the same locks and stops the request.
    const target = await lockAccount(tx, head.targetUserId);
    if (head.organisationId) await lockSociety(tx, head.organisationId);
    await tx.$queryRaw`SELECT "id" FROM "PlatformRecoveryRequest" WHERE "id" = ${requestId} FOR UPDATE`;
    const request = await tx.platformRecoveryRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (request.status !== "pending") throw new PlatformRefusal(`This request is already ${request.status}.`);
    await tx.platformRecoveryRequest.update({ where: { id: request.id }, data: { status: "cancelled", cancelledAt: now, cancelledByUserId: actor.user.id } });
    if (request.kind === "mfa_reset" && target) {
      await tx.accountSecurityEvent.create({ data: { userId: target.id, type: "support_mfa_reset_cancelled", authVersion: target.authVersion, createdAt: now } });
    }
    if (request.organisationId && target) {
      await societyHistory(tx, [{ organisationId: request.organisationId, action: "platform.ownership_recovery_cancelled", targetType: "User", targetId: target.id, metadata: { name: name(target) } }]);
    }
    await notifyPeople(tx, { eventKey: `platform-recovery/${request.id}/cancelled`, template: "recovery_cancelled",
      recipients: (await told(tx, request.id)).map((row) => ({ email: row.recipient, userId: row.userId, relation: "told" })),
      message: request.kind === "mfa_reset"
        ? "Thunderstrux support cancelled the authenticator reset it told you about. Nothing was changed."
        : "Thunderstrux support cancelled the society ownership change it told you about. Nobody's role changed." });
    return { change: { action: "platform.recovery_cancelled", targetType: "Recovery" as const, targetId: request.id, organisationId: request.organisationId, metadata: { kind: request.kind } }, result: {} };
  }, now);
}

// For the request page: the request, who was told and whether the provider took each notice.
export async function readRecoveryRequest(id: string) {
  const request = await prisma.platformRecoveryRequest.findUnique({ where: { id }, select: {
    id: true, kind: true, status: true, reason: true, evidence: true, executeAfter: true, createdAt: true, completedAt: true, cancelledAt: true,
    target: { select: { id: true, email: true, firstName: true, lastName: true, displayName: true, emailVerifiedAt: true, disabledAt: true, closedAt: true,
      platformOperator: { select: { status: true } }, mfa: { select: { enabledAt: true } } } },
    organisation: { select: { id: true, name: true, staff: { where: { status: "active", role: "owner" }, select: { userId: true } } } },
    requestedBy: { select: { email: true, firstName: true, lastName: true, displayName: true } },
    cancelledBy: { select: { email: true, firstName: true, lastName: true, displayName: true } }
  } });
  if (!request) return null;
  const [people, otherOpen] = await Promise.all([
    told(prisma, id),
    prisma.platformRecoveryRequest.count({ where: { id: { not: id }, status: "pending", kind: request.kind, ...(request.organisation ? { organisationId: request.organisation.id } : { targetUserId: request.target.id }) } })
  ]);
  // The recheck Complete shows; the transaction repeats it under locks.
  const target = request.target;
  const checks = [
    { ok: target.emailVerifiedAt !== null && !target.disabledAt && !target.closedAt, text: `${name(target)}'s account is still verified and enabled` },
    { ok: target.platformOperator?.status !== "active", text: `${name(target)} isn't an operator` },
    request.kind === "mfa_reset"
      ? { ok: target.mfa?.enabledAt != null, text: "The authenticator is still set up" }
      : { ok: !request.organisation?.staff.some((row) => row.userId === target.id), text: `${name(target)} isn't an owner yet` },
    { ok: otherOpen === 0, text: request.organisation ? "No other request is open for this society" : "No other request is open for this account" }
  ];
  return { request, people, checks };
}

// Open requests, ready ones first, for the overview and records.
export function listOpenRecoveries(where: Prisma.PlatformRecoveryRequestWhereInput = {}) {
  return prisma.platformRecoveryRequest.findMany({ where: { status: "pending", ...where }, orderBy: { executeAfter: "asc" }, take: 20,
    select: { id: true, kind: true, executeAfter: true, createdAt: true, target: { select: { id: true, email: true, firstName: true, lastName: true, displayName: true } }, organisation: { select: { id: true, name: true } } } });
}

// The wizard's first step for an ownership recovery: an existing account by exact email, with what decides whether it can be picked.
export async function findRecoveryCandidate(email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: {
    id: true, email: true, firstName: true, lastName: true, displayName: true, emailVerifiedAt: true, disabledAt: true, closedAt: true, lastSignInAt: true,
    platformOperator: { select: { status: true } }
  } });
  if (!user) return null;
  const problem = user.closedAt ? "This account is closed." : user.disabledAt ? "This account is disabled." : !user.emailVerifiedAt ? "This email isn't verified yet."
    : user.platformOperator?.status === "active" ? "Operators can't hold society roles." : null;
  return { id: user.id, name: name(user), email: user.email, lastSignInAt: user.lastSignInAt?.toISOString() ?? null, problem };
}
