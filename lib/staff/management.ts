import type { OrganisationStaffRole, OrganisationStaffStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { lockAccount, type AccountActor } from "@/lib/auth/account-lifecycle";
import { hasOrganisationPermission } from "@/lib/permissions";
import { legacyOrganisationAccessMode } from "@/lib/auth/access";
import { mfaEnforcementMode } from "@/lib/security/staff-mfa";
import { mfaGrantDigest } from "@/lib/security/csrf";
export class StaffUpdateError extends Error {
  constructor(readonly kind: "not_found" | "stale_session" | "authority" | "conflict", message: string) { super(message); }
}
export async function updateOrganisationStaff(actor: AccountActor, organisationId: string, staffId: string, input: { role?: OrganisationStaffRole; status?: OrganisationStaffStatus }, now = new Date()) {
  const target = await prisma.organisationStaff.findFirst({ where: { id: staffId, organisationId }, select: { userId: true } });
  if (!target) throw new StaffUpdateError("not_found", "Staff member was not found");
  return prisma.$transaction(async tx => {
    // A shared sorted User-lock order fences closure/password revocation and
    // prevents reciprocal staff updates from deadlocking on actor/target.
    for (const id of [...new Set([actor.id, target.userId])].sort()) await lockAccount(tx, id);
    const liveActor = await tx.user.findUnique({ where: { id: actor.id } });
    if (!liveActor || liveActor.disabledAt || liveActor.authVersion !== actor.authVersion) throw new StaffUpdateError("stale_session", "Sign in again to continue");
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${organisationId} FOR UPDATE`;
    const organisation = await tx.organisation.findUnique({ where: { id: organisationId }, select: { accountUserId: true } });
    const authority = await tx.organisationStaff.findUnique({ where: { organisationId_userId: { organisationId, userId: actor.id } } });
    const permitted = authority ? authority.status === "active" && hasOrganisationPermission(authority.role, "staff:manage") :
      liveActor.accountRole === "organisation" && legacyOrganisationAccessMode() === "allow" && organisation?.accountUserId === actor.id;
    if (!permitted) throw new StaffUpdateError("authority", "Organisation access denied");
    const mode = mfaEnforcementMode();
    if (mode !== "off") {
      const enrollment = await tx.userMfa.findUnique({ where: { userId: actor.id }, select: { enabledAt: true } });
      const digest = mfaGrantDigest(actor.mfaSessionId);
      const grant = digest ? await tx.mfaGrant.findFirst({ where: { userId: actor.id, sessionDigest: digest, expiresAt: { gt: now } } }) : null;
      if ((!enrollment?.enabledAt && mode === "enforce") || (enrollment?.enabledAt && !grant)) throw new StaffUpdateError("authority", "Staff authenticator verification required");
    }
    const existing = await tx.organisationStaff.findFirst({ where: { id: staffId, organisationId }, include: { user: { select: { disabledAt: true } } } });
    if (!existing) throw new StaffUpdateError("not_found", "Staff member was not found");
    const nextRole = input.role ?? existing.role; const nextStatus = input.status ?? existing.status;
    if ((existing.role === "owner" || nextRole === "owner") && authority && authority.role !== "owner")
      throw new StaffUpdateError("authority", "Only owners can change owner authority");
    if (nextStatus === "active" && existing.user.disabledAt) throw new StaffUpdateError("conflict", "Disabled accounts cannot hold active staff access");
    if (existing.role === "owner" && existing.status === "active" && (nextRole !== "owner" || nextStatus !== "active") &&
        await tx.organisationStaff.count({ where: { organisationId, role: "owner", status: "active" } }) <= 1) throw new StaffUpdateError("conflict", "At least one active owner is required");
    const staff = await tx.organisationStaff.update({ where: { id: staffId }, data: { role: nextRole, status: nextStatus, revokedAt: nextStatus === "revoked" ? now : null, revokedById: nextStatus === "revoked" ? actor.id : null },
      select: { id: true, role: true, status: true, acceptedAt: true, revokedAt: true, user: { select: { id: true, email: true } } } });
    await tx.auditLog.create({ data: { organisationId, actorUserId: actor.id, action: "staff.updated", targetType: "OrganisationStaff", targetId: staff.id,
      metadata: { previousRole: existing.role, previousStatus: existing.status, nextRole, nextStatus } } });
    return staff;
  }, { timeout: 15000 });
}

export async function listOrganisationStaff(organisationId: string) {
  const [staff, invites] = await Promise.all([
    prisma.organisationStaff.findMany({ take: 100, where: { organisationId },
      orderBy: [{ status: "asc" }, { role: "asc" }, { createdAt: "asc" }],
      select: { id: true, role: true, status: true, createdAt: true, acceptedAt: true, revokedAt: true,
        user: { select: { id: true, email: true, firstName: true, lastName: true } } } }),
    prisma.organisationStaffInvite.findMany({ where: { organisationId, acceptedAt: null, revokedAt: null },
      take: 100, orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true } })
  ]);
  return { staff, invites };
}
// Accounts the acting owner may hand ownership to: active, verified, enabled and, under enforcement, MFA-enrolled.
export async function listHandoverTargets(organisationId: string, actorUserId: string) {
  return prisma.organisationStaff.findMany({
    where: { organisationId, status: "active", userId: { not: actorUserId }, user: {
      disabledAt: null, emailVerifiedAt: { not: null }, ...(mfaEnforcementMode() === "enforce" ? { mfa: { is: { enabledAt: { not: null } } } } : {})
    } }, take: 100, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, user: { select: { email: true } } }
  });
}
// Invitations that are no longer pending, newest first, for the staff page's history.
export async function listPastStaffInvites(organisationId: string, now = new Date()) {
  const invites = await prisma.organisationStaffInvite.findMany({
    where: { organisationId, OR: [{ acceptedAt: { not: null } }, { revokedAt: { not: null } }, { expiresAt: { lte: now } }] },
    take: 25, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, email: true, role: true, createdAt: true, acceptedAt: true, revokedAt: true }
  });
  return invites.map(({ acceptedAt, revokedAt, ...invite }) => ({ ...invite,
    state: acceptedAt ? "accepted" as const : revokedAt ? "revoked" as const : "expired" as const }));
}
