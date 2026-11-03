import type { Prisma, User } from "@prisma/client";
import { lockAccount } from "@/lib/auth/account-lock";
import { issuePasswordReset, issueVerification } from "@/lib/auth/account-lifecycle";
import { PlatformRefusal, type PlatformActor } from "./authority";
import { notifyPeople, platformWrite, societyHistory, type ChangeInput } from "./changes";
import { livePlatformRole } from "./operators";

// T55: what support can do to one account. Each is a platformWrite; the person
// is told by email, and a disable or re-enable adds a line to the History of
// every society they staff.

export type AccountAction = "resend_verification" | "send_password_reset" | "sign_out_everywhere" | "disable_account" | "enable_account";

const personName = (user: Pick<User, "displayName" | "firstName" | "lastName">) =>
  user.displayName || [user.firstName, user.lastName].filter(Boolean).join(" ") || "A staff member";

// The target, locked, after the operator's own row. Operator accounts are managed
// with `pnpm ops:operator`, never from the portal.
export async function lockTargetAccount(tx: Prisma.TransactionClient, userId: string, actor: PlatformActor) {
  if (userId === actor.user.id) throw new PlatformRefusal("You can't change your own account here.");
  const user = await lockAccount(tx, userId);
  if (!user) throw new PlatformRefusal("That account doesn't exist.");
  if (await livePlatformRole(tx, { id: user.id })) throw new PlatformRefusal("Operator accounts are changed with pnpm ops:operator on the host.");
  if (user.closedAt) throw new PlatformRefusal("Closed accounts can't be changed. Closure is permanent.");
  return user;
}

// Societies the person staffs now (or runs through the legacy login), for History.
async function staffedSocieties(tx: Prisma.TransactionClient, userId: string) {
  const [staff, legacy] = await Promise.all([
    tx.organisationStaff.findMany({ where: { userId, status: "active" }, select: { organisationId: true, role: true } }),
    tx.organisation.findMany({ where: { accountUserId: userId, staff: { none: { userId } } }, select: { id: true } })
  ]);
  return [...staff.map((row) => ({ organisationId: row.organisationId, role: row.role as string })), ...legacy.map((row) => ({ organisationId: row.id, role: "owner" }))];
}

async function signOut(tx: Prisma.TransactionClient, user: User, data: Prisma.UserUpdateInput = {}) {
  const updated = await tx.user.update({ where: { id: user.id }, data: { ...data, authVersion: { increment: 1 } } });
  await tx.mfaGrant.deleteMany({ where: { userId: user.id } });
  return updated;
}

export async function changeAccount(actor: PlatformActor, action: AccountAction, userId: string, input: ChangeInput, now = new Date()) {
  const permission = action === "disable_account" || action === "enable_account" ? "platform:account_disable" : "platform:account_assist";
  return platformWrite(actor, permission, input, async (tx) => {
    const user = await lockTargetAccount(tx, userId, actor);
    const recipient = [{ email: user.email, userId: user.id, relation: "account" }];
    const target = { targetType: "User" as const, targetId: user.id };
    if (action === "resend_verification") {
      if (user.disabledAt) throw new PlatformRefusal("Disabled accounts can't verify. Re-enable it first.");
      if (user.emailVerifiedAt) throw new PlatformRefusal("This email is already verified.");
      await issueVerification(tx, user, undefined, now);
      return { change: { action: "platform.verification_resent", ...target }, result: {} };
    }
    if (action === "send_password_reset") {
      if (user.disabledAt) throw new PlatformRefusal("Disabled accounts can't reset a password. Re-enable it first.");
      await issuePasswordReset(tx, user, now);
      return { change: { action: "platform.password_reset_sent", ...target }, result: {} };
    }
    if (action === "sign_out_everywhere") {
      const updated = await signOut(tx, user);
      const event = await tx.accountSecurityEvent.create({ data: { userId: user.id, type: "support_signed_out", authVersion: updated.authVersion, createdAt: now } });
      await notifyPeople(tx, { eventKey: `platform/${event.id}`, template: "account_signed_out_by_support", recipients: recipient, linkPath: "/forgot-password",
        message: "Thunderstrux support signed your account out on every device. Sign in again to carry on. If you didn't ask for this, reset your password." });
      return { change: { action: "platform.signed_out_everywhere", ...target }, result: {} };
    }
    const societies = await staffedSocieties(tx, user.id);
    const name = personName(user);
    if (action === "disable_account") {
      if (user.disabledAt) throw new PlatformRefusal("This account is already disabled.");
      const updated = await signOut(tx, user, { disabledAt: now });
      const event = await tx.accountSecurityEvent.create({ data: { userId: user.id, type: "support_disabled", authVersion: updated.authVersion, createdAt: now } });
      await notifyPeople(tx, { eventKey: `platform/${event.id}`, template: "account_disabled", recipients: recipient,
        message: "Thunderstrux support disabled your account. You can't sign in, and any society access you hold is paused. Tickets you bought stay valid. Reply to support if you think this is a mistake." });
      await societyHistory(tx, societies.map((row) => ({ organisationId: row.organisationId, action: "platform.member_disabled", targetType: "User", targetId: user.id, metadata: { name, role: row.role } })));
      return { change: { action: "platform.account_disabled", ...target, metadata: { societies: societies.map((row) => row.organisationId) } }, result: {} };
    }
    if (!user.disabledAt) throw new PlatformRefusal("This account isn't disabled.");
    const updated = await tx.user.update({ where: { id: user.id }, data: { disabledAt: null } });
    const event = await tx.accountSecurityEvent.create({ data: { userId: user.id, type: "support_reenabled", authVersion: updated.authVersion, createdAt: now } });
    await notifyPeople(tx, { eventKey: `platform/${event.id}`, template: "account_reenabled", recipients: recipient, linkPath: "/login",
      message: "Thunderstrux support enabled your account again. You can sign in, and your society roles work again." });
    await societyHistory(tx, societies.map((row) => ({ organisationId: row.organisationId, action: "platform.member_reenabled", targetType: "User", targetId: user.id, metadata: { name, role: row.role } })));
    return { change: { action: "platform.account_reenabled", ...target, metadata: { societies: societies.map((row) => row.organisationId) } }, result: {} };
  }, now);
}
