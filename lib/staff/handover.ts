import { prisma } from "@/lib/db";
import { lockAccount, requireSecurityActor, type AccountActor } from "@/lib/auth/account-lifecycle";
import { mfaEnforcementMode } from "@/lib/security/staff-mfa";
import { staffHandoverSchema } from "@/lib/validators/staff";

export class StaffHandoverError extends Error {
  constructor(readonly kind: "authority" | "conflict", message: string) { super(message); }
}
export async function handOverOrganisationOwnership(actor: AccountActor, organisationId: string, input: unknown, now = new Date()) {
  const request = staffHandoverSchema.parse(input);
  const [organisationSnapshot, targetSnapshot] = await Promise.all([
    prisma.organisation.findUnique({ where: { id: organisationId }, select: { accountUserId: true } }),
    prisma.organisationStaff.findFirst({ where: { id: request.incomingStaffId, organisationId }, select: { userId: true } })
  ]);
  if (!organisationSnapshot || !targetSnapshot || targetSnapshot.userId === actor.id)
    throw new StaffHandoverError("conflict", "Choose another eligible staff member in this organisation");
  return prisma.$transaction(async tx => {
    // Same sorted User -> Organisation order as staff changes, invitations and
    // account lifecycle. The legacy user lock also fences account closure.
    const ids = [actor.id, targetSnapshot.userId, ...(organisationSnapshot.accountUserId ? [organisationSnapshot.accountUserId] : [])];
    for (const id of [...new Set(ids)].sort()) await lockAccount(tx, id);
    const user = await requireSecurityActor(tx, actor, request.currentPassword, now);
    if (!user.emailVerifiedAt) throw new StaffHandoverError("authority", "Verify your email before handing over ownership");
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${organisationId} FOR UPDATE`;
    const organisation = await tx.organisation.findUnique({ where: { id: organisationId }, select: { accountUserId: true } });
    if (!organisation || organisation.accountUserId !== organisationSnapshot.accountUserId)
      throw new StaffHandoverError("conflict", "Ownership changed; review staff access and try again");
    const outgoing = await tx.organisationStaff.findUnique({ where: { organisationId_userId: { organisationId, userId: actor.id } } });
    if (outgoing?.role !== "owner" || outgoing.status !== "active")
      throw new StaffHandoverError("authority", "Only an active owner can hand over ownership");
    const incoming = await tx.organisationStaff.findFirst({ where: { id: request.incomingStaffId, organisationId }, include: {
      user: { select: { id: true, disabledAt: true, emailVerifiedAt: true, mfa: { select: { enabledAt: true } } } }
    } });
    if (!incoming || incoming.userId !== targetSnapshot.userId || incoming.status !== "active" || incoming.user.disabledAt || !incoming.user.emailVerifiedAt)
      throw new StaffHandoverError("conflict", "Choose another eligible staff member in this organisation");
    if (mfaEnforcementMode() === "enforce") {
      const actorMfa = await tx.userMfa.findUnique({ where: { userId: actor.id }, select: { enabledAt: true } });
      // requireSecurityActor already verifies any enrolled actor's login grant.
      if (!actorMfa?.enabledAt || !incoming.user.mfa?.enabledAt)
        throw new StaffHandoverError("authority", "Both owners must have an enrolled authenticator before handover");
    }
    await tx.organisationStaff.update({ where: { id: incoming.id }, data: { role: "owner" } });
    const revoked = request.outgoingAccess === "revoked";
    await tx.organisationStaff.update({ where: { id: outgoing.id }, data: {
      role: revoked ? "owner" : "admin", status: revoked ? "revoked" : "active",
      revokedAt: revoked ? now : null, revokedById: revoked ? actor.id : null
    } });
    if (await tx.organisationStaff.count({ where: { organisationId, role: "owner", status: "active" } }) < 1)
      throw new StaffHandoverError("conflict", "At least one active owner is required");
    await tx.organisation.update({ where: { id: organisationId }, data: { accountUserId: null } });
    await tx.auditLog.create({ data: { organisationId, actorUserId: actor.id, action: "staff.ownership.handed_over", targetType: "OrganisationStaff", targetId: incoming.id,
      metadata: { incomingUserId: incoming.userId, incomingStaffId: incoming.id, incomingPreviousRole: incoming.role, incomingRole: "owner", incomingStatus: "active",
        outgoingUserId: actor.id, outgoingStaffId: outgoing.id, outgoingPreviousRole: outgoing.role, outgoingPreviousStatus: outgoing.status,
        outgoingRole: revoked ? "owner" : "admin", outgoingStatus: revoked ? "revoked" : "active",
        retiredAccountUserId: organisation.accountUserId, legacyOwnershipRetired: true } } });
    return { handedOver: true, incomingStaffId: incoming.id, outgoingAccess: request.outgoingAccess, legacyOwnershipRetired: true };
  }, { timeout: 15000 });
}
