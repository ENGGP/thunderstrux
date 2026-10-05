import { randomBytes, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import { AccountSecurityError, invalidateAccountTokens, lockAccount, requireSecurityActor, type AccountActor } from "./account-lifecycle";

export const closureAcknowledgement = "CLOSE MY ACCOUNT";
export class AccountClosureError extends Error {
  constructor(readonly kind: "blocked" | "acknowledgement", message: string) { super(message); }
}
export async function accountClosureEligibility(tx: Prisma.TransactionClient, userId: string, now = new Date()) {
  const blockers: string[] = [];
  if (await tx.organisationStaff.count({ where: { userId, role: "owner", status: "active" } }) ||
      await tx.organisation.count({ where: { accountUserId: userId } })) blockers.push("Hand over organisation ownership before closing your account.");
  if (await tx.order.count({ where: { userId, status: "pending" } })) blockers.push("Resolve pending orders before closing your account.");
  if (await tx.order.count({ where: { userId, OR: [{ requiresCompensationReview: true }, { compensationRefundJob: { is: { state: { notIn: ["refunded", "recovered"] } } } }] } })) blockers.push("Resolve outstanding payment compensation before closing your account.");
  if (await tx.order.count({ where: { userId, status: "paid", totalAmount: { gt: 0 }, event: { is: { endTime: { gt: now } } } } })) blockers.push("Wait until upcoming paid events finish or resolve their purchases before closing your account.");
  return { eligible: blockers.length === 0, blockers };
}
export async function readAccountClosureEligibility(actor: AccountActor, now = new Date()) {
  return prisma.$transaction(async tx => {
    const user = await lockAccount(tx, actor.id);
    if (!user || user.disabledAt || user.authVersion !== actor.authVersion) throw new AccountSecurityError("stale_session", "Sign in again to continue");
    return accountClosureEligibility(tx, user.id, now);
  });
}
export async function closeAccount(actor: AccountActor, currentPassword: string, acknowledgement: string, now = new Date()) {
  if (acknowledgement !== closureAcknowledgement) throw new AccountClosureError("acknowledgement", "Enter CLOSE MY ACCOUNT to acknowledge permanent closure.");
  await prisma.$transaction(async tx => {
    const user = await requireSecurityActor(tx, actor, currentPassword, now);
    // Purchases/joins/organisation creation/invite acceptance lock this User.
    // Lock retained orders too, so workers/staff cannot change blockers during
    // the final decision. Later provider events still retain provider truth.
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "userId" = ${user.id} ORDER BY "id" FOR UPDATE`;
    const eligibility = await accountClosureEligibility(tx, user.id, now);
    if (!eligibility.eligible) throw new AccountClosureError("blocked", eligibility.blockers.join(" "));
    await tx.order.updateMany({ where: { userId: user.id, buyerIdentityCapturedAt: null }, data: {
      buyerEmailSnapshot: user.email, buyerFirstNameSnapshot: user.firstName, buyerLastNameSnapshot: user.lastName,
      buyerDisplayNameSnapshot: user.displayName, buyerIdentityCapturedAt: now, buyerIdentityProvenance: "current_account_at_capture"
    } });
    await invalidateAccountTokens(tx, user.id, undefined, now);
    await tx.authToken.deleteMany({ where: { userId: user.id } });
    await tx.mfaGrant.deleteMany({ where: { userId: user.id } });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
    await tx.userMfa.deleteMany({ where: { userId: user.id } });
    await tx.organisationStaff.updateMany({ where: { userId: user.id, status: "active" }, data: { status: "revoked", revokedAt: now, revokedById: user.id } });
    await tx.organisationMember.deleteMany({ where: { userId: user.id } });
    if (user.emailVerifiedAt) await tx.organisationStaffInvite.updateMany({ where: { email: user.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: now } });
    const closed = await tx.user.update({ where: { id: user.id }, data: {
      closedAt: now, disabledAt: now, authVersion: { increment: 1 }, email: `${randomUUID()}@closed.invalid`, password: `!closed:${randomBytes(32).toString("base64url")}`,
      emailVerifiedAt: null, firstName: null, lastName: null, displayName: null, phone: null, studentNumber: null, onboardingCompletedAt: null
    } });
    const event = await tx.accountSecurityEvent.create({ data: { userId: user.id, type: "account_closed", authVersion: closed.authVersion, createdAt: now } });
    await enqueueNotification(tx, { eventKey: `account-security/${event.id}`, userId: user.id, recipient: user.email, template: "account_closed",
      payload: { message: "Your Thunderstrux account is permanently closed and all devices are signed out. Your editable profile and login credentials have been anonymised. Purchases, tickets, attendance, buyer contact details needed for those records, and audit/security records are retained. A new signup does not regain access to these records.", link: new URL("/login", process.env.NEXT_PUBLIC_APP_URL).toString() } });
  }, { timeout: 15000 });
}
