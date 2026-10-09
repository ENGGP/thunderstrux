import type { Prisma } from "@prisma/client";

// Caller holds the affected User lock; acceptance and resend share that fence.
export async function cancelAccountStaffInvites(tx: Prisma.TransactionClient, user: { id: string; email: string; emailVerifiedAt: Date | null }, includeIssued: boolean, now: Date) {
  const conditions = [
    ...(user.emailVerifiedAt ? [{ email: user.email }] : []),
    ...(includeIssued ? [{ invitedById: user.id }] : [])
  ];
  if (!conditions.length) return;
  const invites = await tx.organisationStaffInvite.findMany({ where: { acceptedAt: null, revokedAt: null, OR: conditions }, select: { id: true } });
  const ids = invites.map(invite => invite.id);
  if (!ids.length) return;
  await tx.organisationStaffInvite.updateMany({ where: { id: { in: ids }, acceptedAt: null, revokedAt: null }, data: { revokedAt: now } });
  await tx.notificationOutbox.updateMany({ where: { staffInviteId: { in: ids }, status: { in: ["pending", "processing"] } }, data: {
    status: "cancelled", processingToken: null, lastError: "obsolete_invite"
  } });
}
