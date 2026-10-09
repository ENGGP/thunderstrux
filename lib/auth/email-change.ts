import { cancelAccountStaffInvites } from "@/lib/staff/invite-cancellation";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import { AccountTokenError, accountTokenDigest, invalidateAccountTokens, requireSecurityActor, type AccountActor } from "./account-lifecycle";
export const accountEmailSchema = z.string().trim().toLowerCase().email().max(320);
export class EmailChangeError extends Error {}
export async function requestEmailChange(actor: AccountActor, currentPassword: string, address: string, now = new Date()) {
  const newEmail = accountEmailSchema.parse(address);
  await prisma.$transaction(async tx => {
    const user = await requireSecurityActor(tx, actor, currentPassword, now);
    if (newEmail === user.email) throw new EmailChangeError("Choose a different email address");
    await invalidateAccountTokens(tx, user.id, "email_change", now);
    const event = await tx.accountSecurityEvent.create({ data: { userId: user.id, type: "email_change_requested", authVersion: user.authVersion, createdAt: now } });
    // Always notify the current address, including ineligible proposed addresses.
    // Responses and configuration failures remain independent of uniqueness.
    await enqueueNotification(tx, { eventKey: `account-security/${event.id}`, userId: user.id, recipient: user.email, template: "email_change_requested",
      payload: { message: "An email change was requested for your Thunderstrux account. Your current email remains active until the new address is confirmed. If this was not you, reset your password.", link: new URL("/forgot-password", process.env.NEXT_PUBLIC_APP_URL).toString() } });
    const raw = randomBytes(32).toString("base64url");
    const token = await tx.authToken.create({ data: { userId: user.id, tokenHash: accountTokenDigest(raw), purpose: "email_change", email: user.email,
      newEmail, authVersion: user.authVersion, expiresAt: new Date(now.getTime() + 1800000), callbackPath: "/account/settings" } });
    const link = new URL("/change-email", process.env.NEXT_PUBLIC_APP_URL); link.hash = new URLSearchParams({ token: raw }).toString();
    await enqueueNotification(tx, { eventKey: `auth/${token.id}`, authTokenId: token.id, userId: user.id, recipient: newEmail, template: "email_change_requested", expiresAt: token.expiresAt,
      payload: { message: "Confirm this address as your new Thunderstrux email. Sign in to the existing account and enter its current password. This link expires in 30 minutes.", link: link.toString() } });
  });
}
export async function confirmEmailChange(actor: AccountActor, currentPassword: string, raw: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new AccountTokenError();
  try {
    await prisma.$transaction(async tx => {
      const user = await requireSecurityActor(tx, actor, currentPassword, now);
      const token = await tx.authToken.findUnique({ where: { tokenHash: accountTokenDigest(raw) } });
      if (!token || token.userId !== user.id || token.purpose !== "email_change" || !token.newEmail || token.newEmail === user.email ||
          token.email !== user.email || token.authVersion !== user.authVersion || token.expiresAt <= now || token.consumedAt || token.invalidatedAt) throw new AccountTokenError();
      if (await tx.user.findUnique({ where: { email: token.newEmail }, select: { id: true } })) throw new AccountTokenError();
      const consumed = await tx.authToken.updateMany({ where: { id: token.id, consumedAt: null, invalidatedAt: null }, data: { consumedAt: now } });
      if (consumed.count !== 1) throw new AccountTokenError();
      const updated = await tx.user.update({ where: { id: user.id }, data: { email: token.newEmail, emailVerifiedAt: now, authVersion: { increment: 1 } } });
      await tx.mfaGrant.deleteMany({ where: { userId: user.id } });
      await invalidateAccountTokens(tx, user.id, undefined, now);
      await tx.notificationOutbox.updateMany({ where: { authTokenId: token.id, status: { in: ["pending", "processing"] } }, data: { status: "cancelled", lastError: "consumed", processingToken: null } });
      // Verified addresses must not leave invitations a recycled address can accept.
      await cancelAccountStaffInvites(tx, user, false, now);
      const event = await tx.accountSecurityEvent.create({ data: { userId: user.id, type: "email_changed", authVersion: updated.authVersion, createdAt: now } });
      for (const recipient of [user.email, updated.email]) await enqueueNotification(tx, { eventKey: `account-security/${event.id}`, userId: user.id, recipient, template: "email_changed",
        payload: { message: "Your Thunderstrux account email changed. All devices are signed out. Sign in using the new address. If this was not you, contact support.", link: new URL("/login", process.env.NEXT_PUBLIC_APP_URL).toString() } });
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new AccountTokenError();
    throw error;
  }
}
export async function cancelEmailChange(actor: AccountActor, currentPassword: string, now = new Date()) {
  await prisma.$transaction(async tx => {
    const user = await requireSecurityActor(tx, actor, currentPassword, now);
    const pending = await tx.authToken.count({ where: { userId: user.id, purpose: "email_change", consumedAt: null, invalidatedAt: null } });
    await invalidateAccountTokens(tx, user.id, "email_change", now);
    if (pending) await tx.accountSecurityEvent.create({ data: { userId: user.id, type: "email_change_cancelled", authVersion: user.authVersion, createdAt: now } });
  });
}
