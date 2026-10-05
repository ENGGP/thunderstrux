import { createHash, randomBytes } from "node:crypto";
import { compare, hash } from "bcryptjs";
import type { Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import { assertNotificationConfiguration } from "@/lib/email/notification-crypto";
import { renderNotification, renderedNotificationSchema } from "@/lib/email/templates";
import { safeReturnPath } from "@/lib/security/safe-return-path";
import { mfaGrantDigest } from "@/lib/security/csrf";
import { newPasswordSchema } from "@/lib/validators/auth";
import { lockAccount } from "./account-lock";
export { lockAccount } from "./account-lock";

export class AccountTokenError extends Error {
  constructor() { super("This link is invalid or expired. Request a new link."); }
}
function assertIssuanceConfiguration() {
  // Fail uniformly before looking up addresses, including during misconfiguration.
  assertNotificationConfiguration();
  const link = new URL("/verify-email", process.env.NEXT_PUBLIC_APP_URL).toString();
  renderedNotificationSchema.parse({ ...renderNotification("verify_account", { message: "Configuration check", link }), from: process.env.EMAIL_FROM });
}
export function accountTokenDigest(raw: string) { return createHash("sha256").update(raw).digest("hex"); }
export class AccountVerificationError extends Error {
  constructor() { super("Verify your email before using this feature"); }
}
export async function lockVerifiedAccount(tx: Prisma.TransactionClient, userId: string) {
  const user = await lockAccount(tx, userId);
  if (!user || user.disabledAt || !user.emailVerifiedAt) throw new AccountVerificationError();
  return user;
}
export async function invalidateAccountTokens(tx: Prisma.TransactionClient, userId: string, purpose?: string, now = new Date()) {
  const where = { userId, ...(purpose ? { purpose } : {}), consumedAt: null, invalidatedAt: null };
  const tokens = await tx.authToken.findMany({ where, select: { id: true } });
  await tx.authToken.updateMany({ where, data: { invalidatedAt: now } });
  await tx.notificationOutbox.updateMany({ where: { authTokenId: { in: tokens.map(token => token.id) }, status: { in: ["pending", "processing"] } },
    data: { status: "cancelled", lastError: "superseded", processingToken: null, processingStartedAt: null } });
}
async function issueAccountToken(tx: Prisma.TransactionClient, user: User, purpose: "verify_account" | "reset_password", callbackUrl?: string, now = new Date()) {
  await invalidateAccountTokens(tx, user.id, purpose, now);
  const raw = randomBytes(32).toString("base64url");
  const token = await tx.authToken.create({ data: { userId: user.id, tokenHash: accountTokenDigest(raw), purpose,
    email: user.email, authVersion: user.authVersion, expiresAt: new Date(now.getTime() + (purpose === "verify_account" ? 86400000 : 1800000)), callbackPath: safeReturnPath(callbackUrl) } });
  const link = new URL(purpose === "verify_account" ? "/verify-email" : "/reset-password", process.env.NEXT_PUBLIC_APP_URL);
  link.hash = new URLSearchParams({ token: raw }).toString();
  await enqueueNotification(tx, { eventKey: `auth/${token.id}`, authTokenId: token.id, userId: user.id, recipient: user.email,
    template: purpose, expiresAt: token.expiresAt, payload: { message: purpose === "verify_account" ? "Confirm your email address to use Thunderstrux purchases and society features." : "Reset your Thunderstrux password. This link expires in 30 minutes.", link: link.toString() } });
}
export function issueVerification(tx: Prisma.TransactionClient, user: User, callbackUrl?: string, now = new Date()) {
  return issueAccountToken(tx, user, "verify_account", callbackUrl, now);
}
export async function signupAccount(input: { email: string; password: string; accountRole: "member" | "organisation"; firstName?: string; lastName?: string; callbackUrl?: string }) {
  assertIssuanceConfiguration();
  // Perform the expensive hash for existing addresses too; never overwrite them.
  const password = await hash(input.password, 12);
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: input.email.trim().toLowerCase(), password, accountRole: input.accountRole,
        firstName: input.firstName || null, lastName: input.lastName || null,
        onboardingCompletedAt: input.accountRole === "member" && input.firstName && input.lastName ? new Date() : null } });
      await issueVerification(tx, user, input.callbackUrl);
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return;
    throw error;
  }
}
export async function requestVerification(email: string, callbackUrl?: string) {
  assertIssuanceConfiguration();
  const identity = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
  if (!identity) return;
  await prisma.$transaction(async tx => {
    const user = await lockAccount(tx, identity.id);
    if (!user || user.disabledAt || user.emailVerifiedAt || user.email !== email.trim().toLowerCase()) return;
    await issueVerification(tx, user, callbackUrl);
  });
}
export async function consumeVerification(raw: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new AccountTokenError();
  return prisma.$transaction(async tx => {
    const candidate = await tx.authToken.findUnique({ where: { tokenHash: accountTokenDigest(raw) }, select: { userId: true } });
    if (!candidate) throw new AccountTokenError();
    const user = await lockAccount(tx, candidate.userId);
    const token = await tx.authToken.findUnique({ where: { tokenHash: accountTokenDigest(raw) } });
    if (!user || user.disabledAt || !token || token.purpose !== "verify_account" || token.consumedAt || token.invalidatedAt || token.expiresAt <= now ||
        token.email !== user.email || token.authVersion !== user.authVersion || user.emailVerifiedAt) throw new AccountTokenError();
    const consumed = await tx.authToken.updateMany({ where: { id: token.id, consumedAt: null, invalidatedAt: null }, data: { consumedAt: now } });
    if (consumed.count !== 1) throw new AccountTokenError();
    await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now } });
    await invalidateAccountTokens(tx, user.id, "verify_account", now);
    await tx.notificationOutbox.updateMany({ where: { authTokenId: token.id, status: { in: ["pending", "processing"] } }, data: { status: "cancelled", processingToken: null, lastError: "consumed" } });
    return { verified: true, callbackUrl: safeReturnPath(token.callbackPath) };
  });
}

export type AccountActor = { id: string; authVersion: number; mfaSessionId?: string };
export class AccountSecurityError extends Error {
  constructor(readonly kind: "stale_session" | "invalid_password" | "mfa_required" | "role_required", message: string) { super(message); }
}
export async function requireSecurityActor(tx: Prisma.TransactionClient, actor: AccountActor, password: string, now = new Date()) {
  const user = await lockAccount(tx, actor.id);
  if (!user || user.disabledAt || user.authVersion !== actor.authVersion) throw new AccountSecurityError("stale_session", "Sign in again to continue");
  if (!await compare(password, user.password)) throw new AccountSecurityError("invalid_password", "Current password is incorrect");
  const mfa = await tx.userMfa.findUnique({ where: { userId: user.id }, select: { enabledAt: true } });
  if (mfa?.enabledAt) {
    const digest = mfaGrantDigest(actor.mfaSessionId);
    const grant = digest ? await tx.mfaGrant.findFirst({ where: { userId: user.id, sessionDigest: digest, expiresAt: { gt: now }, verifiedAt: { lte: now } } }) : null;
    if (!grant) throw new AccountSecurityError("mfa_required", "Verify your enrolled authenticator before changing account security");
  }
  return user;
}
async function passwordSecurityNotice(tx: Prisma.TransactionClient, user: User, type: "password_reset" | "password_changed", now: Date) {
  const event = await tx.accountSecurityEvent.create({ data: { userId: user.id, type, authVersion: user.authVersion, createdAt: now } });
  await enqueueNotification(tx, { eventKey: `account-security/${event.id}`, userId: user.id, recipient: user.email, template: "password_changed",
    payload: { message: "Your Thunderstrux password changed. All sessions have been signed out. If this was not you, reset your password.", link: new URL("/forgot-password", process.env.NEXT_PUBLIC_APP_URL).toString() } });
}
export async function requestPasswordReset(email: string, callbackUrl?: string) {
  assertIssuanceConfiguration();
  const identity = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
  if (!identity) return;
  await prisma.$transaction(async tx => {
    const user = await lockAccount(tx, identity.id);
    if (!user || user.disabledAt || user.email !== email.trim().toLowerCase()) return;
    await issueAccountToken(tx, user, "reset_password", callbackUrl);
  });
}
export async function consumePasswordReset(raw: string, newPassword: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new AccountTokenError();
  const password = await hash(newPasswordSchema.parse(newPassword), 12);
  return prisma.$transaction(async tx => {
    const candidate = await tx.authToken.findUnique({ where: { tokenHash: accountTokenDigest(raw) }, select: { userId: true } });
    if (!candidate) throw new AccountTokenError();
    const user = await lockAccount(tx, candidate.userId);
    const token = await tx.authToken.findUnique({ where: { tokenHash: accountTokenDigest(raw) } });
    if (!user || user.disabledAt || !token || token.purpose !== "reset_password" || token.consumedAt || token.invalidatedAt || token.expiresAt <= now ||
        token.email !== user.email || token.authVersion !== user.authVersion) throw new AccountTokenError();
    const consumed = await tx.authToken.updateMany({ where: { id: token.id, consumedAt: null, invalidatedAt: null }, data: { consumedAt: now } });
    if (consumed.count !== 1) throw new AccountTokenError();
    const updated = await tx.user.update({ where: { id: user.id }, data: { password, authVersion: { increment: 1 } } });
    await tx.mfaGrant.deleteMany({ where: { userId: user.id } });
    await invalidateAccountTokens(tx, user.id, undefined, now);
    await tx.notificationOutbox.updateMany({ where: { authTokenId: token.id, status: { in: ["pending", "processing"] } }, data: { status: "cancelled", processingToken: null, lastError: "consumed" } });
    await passwordSecurityNotice(tx, updated, "password_reset", now);
    return { reset: true, callbackUrl: safeReturnPath(token.callbackPath) };
  });
}
export async function changePassword(actor: AccountActor, currentPassword: string, newPassword: string, now = new Date()) {
  const password = await hash(newPasswordSchema.parse(newPassword), 12);
  await prisma.$transaction(async tx => {
    const user = await requireSecurityActor(tx, actor, currentPassword, now);
    const updated = await tx.user.update({ where: { id: user.id }, data: { password, authVersion: { increment: 1 } } });
    await tx.mfaGrant.deleteMany({ where: { userId: user.id } });
    await invalidateAccountTokens(tx, user.id, undefined, now);
    await passwordSecurityNotice(tx, updated, "password_changed", now);
  });
}
