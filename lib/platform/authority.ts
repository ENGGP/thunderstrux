import { notFound, redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { lockAccount } from "@/lib/auth/account-lock";
import { appUrl } from "@/lib/app-url";
import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/auth/access";
import { hasPlatformPermission, type PlatformPermission } from "@/lib/permissions/platform";
import { mfaGrantDigest } from "@/lib/security/csrf";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { assertStaffMfaMutationConfiguration, consumeStaffMfaCode, MfaConfigurationError, MfaInputError } from "@/lib/security/staff-mfa";
import { ADMIN_WINDOW_MS, isAdminPortalEnabled } from "./mode";
import { livePlatformRole } from "./operators";

// Not an operator, a revoked one, a missing permission, or the portal off in
// this process: every one is the same concealed 404.
export class PlatformAccessError extends Error {
  constructor() {
    super("Not found");
    this.name = "PlatformAccessError";
  }
}

// An operator with no authenticator, or none verified in the last 60 minutes.
export class PlatformVerificationRequiredError extends Error {
  constructor(readonly enrolled: boolean) {
    super(enrolled ? "Verify with your authenticator to continue" : "Set up an authenticator to continue");
    this.name = "PlatformVerificationRequiredError";
  }
}

// A change that doesn't apply: the message says exactly why, and nothing was changed or recorded.
export class PlatformRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformRefusal";
  }
}

export class PlatformUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformUnavailableError";
  }
}

export type PlatformActor = Awaited<ReturnType<typeof requirePlatformOperator>>;

// Admin MFA is always on: it never reads MFA_ENFORCEMENT_MODE, which the
// preview runs "off" for society staff. A change (T55) skips the 60-minute
// window: its own fresh code verifies, so a change never bounces to /mfa.
export async function requirePlatformOperator(permission: PlatformPermission, now = new Date(), { freshCode = false } = {}) {
  if (!isAdminPortalEnabled()) throw new PlatformAccessError();
  const user = await requireAuthenticatedUser();
  const role = await livePlatformRole(prisma, user);
  if (!role) throw new PlatformAccessError();
  try {
    assertStaffMfaMutationConfiguration();
  } catch (error) {
    if (error instanceof MfaConfigurationError) throw new PlatformUnavailableError(error.message);
    throw error;
  }
  const digest = mfaGrantDigest(user.mfaSessionId);
  const [mfa, grant] = await Promise.all([
    prisma.userMfa.findUnique({ where: { userId: user.id }, select: { enabledAt: true } }),
    digest ? prisma.mfaGrant.findUnique({ where: { sessionDigest: digest }, select: { userId: true, verifiedAt: true, expiresAt: true } }) : null
  ]);
  if (!mfa?.enabledAt) throw new PlatformVerificationRequiredError(false);
  const windowEndsAt = grant ? new Date(grant.verifiedAt.getTime() + ADMIN_WINDOW_MS) : null;
  if (!freshCode && (!grant || !windowEndsAt || grant.userId !== user.id || grant.expiresAt <= now || windowEndsAt <= now)) {
    throw new PlatformVerificationRequiredError(true);
  }
  if (!hasPlatformPermission(role, permission)) throw new PlatformAccessError();
  return { user, role, windowEndsAt: windowEndsAt ?? now };
}

// T55: an admin API route. Origin and CSRF first on a change, then the same
// guards as a page (a non-operator gets the 404), then the operator's limit:
// reads fail open like pages, changes fail closed.
export async function platformApiActor(request: Request, permission: PlatformPermission, change: boolean):
  Promise<{ actor: PlatformActor; response?: never } | { response: Response; actor?: never }> {
  if (change) {
    const guard = enforceTrustedMutationRequest(request);
    if (guard) return { response: guard };
  }
  const actor = await requirePlatformOperator(permission, new Date(), { freshCode: change });
  const limited = await enforceRateLimit({ policy: change ? "platform_write" : "platform_read", request, keyParts: [actor.user.id], required: change });
  return limited ? { response: limited } : { actor };
}

// Inside every change's transaction, before anything else is locked: the
// operator's own row first (the lock order in Database and Multi Tenancy), then
// a live recheck, then the fresh code, used once.
export async function lockPlatformActor(tx: Prisma.TransactionClient, actor: PlatformActor, permission: PlatformPermission, code: string, now = new Date()) {
  const user = await lockAccount(tx, actor.user.id);
  if (!user || user.disabledAt || user.closedAt || user.authVersion !== actor.user.authVersion) throw new PlatformAccessError();
  const role = await livePlatformRole(tx, user);
  if (!role || !hasPlatformPermission(role, permission)) throw new PlatformAccessError();
  const digest = mfaGrantDigest(actor.user.mfaSessionId);
  if (!digest) throw new PlatformAccessError();
  if (!/^\d{6}$/.test(code)) throw new PlatformRefusal("Enter the 6-digit code from your authenticator app.");
  try {
    await consumeStaffMfaCode(tx, user.id, code, digest, now);
  } catch (error) {
    if (!(error instanceof MfaInputError)) throw error;
    throw new PlatformRefusal(/already used/.test(error.message)
      ? "That code was already used. Each code works once; wait for the next one."
      : "That code didn't work. Check your phone's clock and try the current code.");
  }
  return { user, role };
}

// Every admin page: the guards above, then the read limit (600 an hour per
// operator, fail open so an incident can still be investigated without Redis).
export async function requirePlatformPage(permission: PlatformPermission, callbackPath: string) {
  try {
    const actor = await requirePlatformOperator(permission);
    const limited = await enforceRateLimit({
      policy: "platform_read",
      request: new Request(new URL(callbackPath, appUrl() ?? "http://localhost")),
      keyParts: [actor.user.id]
    });
    if (limited) throw new PlatformUnavailableError("Too many admin pages opened in the last hour. Wait a few minutes.");
    return actor;
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect(`/login?callbackUrl=${encodeURIComponent(callbackPath)}`);
    if (error instanceof PlatformVerificationRequiredError) redirect(`/mfa?callbackUrl=${encodeURIComponent(callbackPath)}`);
    if (error instanceof PlatformAccessError) notFound();
    throw error;
  }
}

// Where sign-in lands: an operator in the admin process goes to the overview, not the society dashboard.
export async function landsInAdmin(user: { id: string; disabledAt?: Date | null }) {
  return isAdminPortalEnabled() && (await livePlatformRole(prisma, user)) !== null;
}
