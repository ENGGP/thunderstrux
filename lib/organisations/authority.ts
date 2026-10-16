import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { lockAccount } from "@/lib/auth/account-lock";
import type { AccountActor } from "@/lib/auth/account-lifecycle";
import { AuthenticationRequiredError, OrganisationAccessError, StaffMfaRequiredError } from "@/lib/auth/access";
import type { OrganisationPermission } from "@/lib/permissions";
import { liveStaffRole, roleHasPermission } from "@/lib/staff/live-authority";
import { mfaEnforcementMode } from "@/lib/security/staff-mfa";
import { mfaGrantDigest } from "@/lib/security/csrf";

// Extend the existing User -> Organisation lock order; recheck authority after waiting.
export async function lockOrganisationActor(tx: Prisma.TransactionClient, actor: AccountActor, organisationId: string, permission: OrganisationPermission) {
  const user = await lockAccount(tx, actor.id);
  if (!user || user.disabledAt || user.authVersion !== actor.authVersion) throw new AuthenticationRequiredError();
  await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${organisationId} FOR UPDATE`;
  const organisation = await tx.organisation.findUnique({ where: { id: organisationId } });
  const permitted = organisation !== null && roleHasPermission(await liveStaffRole(tx, organisationId, user), permission);
  if (!organisation || !permitted) throw new OrganisationAccessError("Organisation not found or access denied");
  const mode = mfaEnforcementMode();
  if (mode !== "off") {
    const enrollment = await tx.userMfa.findUnique({ where: { userId: actor.id }, select: { enabledAt: true } });
    const digest = mfaGrantDigest(actor.mfaSessionId);
    const grant = digest ? await tx.mfaGrant.findFirst({ where: { userId: actor.id, sessionDigest: digest, expiresAt: { gt: new Date() } } }) : null;
    if ((!enrollment?.enabledAt && mode === "enforce") || (enrollment?.enabledAt && !grant)) throw new StaffMfaRequiredError("Staff authenticator verification required");
  }
  return organisation;
}

export async function organisationIdBySlug(slug: string) {
  return (await prisma.organisation.findUnique({ where: { slug }, select: { id: true } }))?.id ?? null;
}
