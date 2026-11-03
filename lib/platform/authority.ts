import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/app-url";
import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/auth/access";
import { hasPlatformPermission, type PlatformPermission } from "@/lib/permissions/platform";
import { mfaGrantDigest } from "@/lib/security/csrf";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { assertStaffMfaMutationConfiguration, MfaConfigurationError } from "@/lib/security/staff-mfa";
import { ADMIN_WINDOW_MS, isAdminPortalEnabled } from "./mode";
import { livePlatformRole } from "./operators";

export { livePlatformRole };

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

export class PlatformUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformUnavailableError";
  }
}

export type PlatformActor = Awaited<ReturnType<typeof requirePlatformOperator>>;

// Admin MFA is always on: it never reads MFA_ENFORCEMENT_MODE, which the
// preview runs "off" for society staff.
export async function requirePlatformOperator(permission: PlatformPermission, now = new Date()) {
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
  const mfa = await prisma.userMfa.findUnique({ where: { userId: user.id }, select: { enabledAt: true } });
  if (!mfa?.enabledAt) throw new PlatformVerificationRequiredError(false);
  const digest = mfaGrantDigest(user.mfaSessionId);
  const grant = digest ? await prisma.mfaGrant.findUnique({ where: { sessionDigest: digest }, select: { userId: true, verifiedAt: true, expiresAt: true } }) : null;
  const windowEndsAt = grant ? new Date(grant.verifiedAt.getTime() + ADMIN_WINDOW_MS) : null;
  if (!grant || !windowEndsAt || grant.userId !== user.id || grant.expiresAt <= now || windowEndsAt <= now) {
    throw new PlatformVerificationRequiredError(true);
  }
  if (!hasPlatformPermission(role, permission)) throw new PlatformAccessError();
  return { user, role, windowEndsAt };
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
