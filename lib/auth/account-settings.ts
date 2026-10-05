import { prisma } from "@/lib/db";
import { mfaGrantDigest } from "@/lib/security/csrf";
import { memberProfileSchema } from "@/lib/validators/auth";
import { AccountSecurityError, lockAccount, type AccountActor } from "./account-lifecycle";
export async function readAccountSettings(actor: AccountActor, now = new Date()) {
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: {
    id: true, email: true, accountRole: true, authVersion: true, disabledAt: true, emailVerifiedAt: true,
    firstName: true, lastName: true, displayName: true, phone: true, studentNumber: true, onboardingCompletedAt: true,
    mfa: { select: { enabledAt: true } }, securityEvents: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10, select: { type: true, createdAt: true } }
  } });
  if (!user || user.disabledAt || user.authVersion !== actor.authVersion) throw new AccountSecurityError("stale_session", "Sign in again to continue");
  const digest = mfaGrantDigest(actor.mfaSessionId);
  const grant = user.mfa?.enabledAt && digest ? await prisma.mfaGrant.findFirst({ where: { userId: user.id, sessionDigest: digest, expiresAt: { gt: now }, verifiedAt: { lte: now } }, select: { sessionDigest: true } }) : null;
  return { user: { id: user.id, email: user.email, accountRole: user.accountRole, emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    firstName: user.firstName, lastName: user.lastName, displayName: user.displayName, phone: user.phone, studentNumber: user.studentNumber,
    onboardingCompletedAt: user.onboardingCompletedAt?.toISOString() ?? null },
    mfa: { enabled: Boolean(user.mfa?.enabledAt), verified: Boolean(grant) },
    securityEvents: user.securityEvents.map(event => ({ type: event.type, createdAt: event.createdAt.toISOString() })) };
}
export async function updateAccountProfile(actor: AccountActor, input: unknown) {
  const profile = memberProfileSchema.parse(input);
  return prisma.$transaction(async tx => {
    const user = await lockAccount(tx, actor.id);
    if (!user || user.disabledAt || user.authVersion !== actor.authVersion) throw new AccountSecurityError("stale_session", "Sign in again to continue");
    if (user.accountRole !== "member") throw new AccountSecurityError("role_required", "Member account required");
    return tx.user.update({ where: { id: user.id }, data: { firstName: profile.firstName, lastName: profile.lastName, displayName: profile.displayName || null,
      phone: profile.phone || null, studentNumber: profile.studentNumber || null, onboardingCompletedAt: new Date() },
      select: { id: true, email: true, accountRole: true, firstName: true, lastName: true, displayName: true, phone: true, studentNumber: true, onboardingCompletedAt: true } });
  });
}
