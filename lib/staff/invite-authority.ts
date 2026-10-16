import type { Prisma } from "@prisma/client";
import { liveStaffRole, roleHasPermission } from "@/lib/staff/live-authority";

// Database-only authority: notification workers must not load HTTP auth/CSRF.
export async function invitationIssuerRole(db: Prisma.TransactionClient, organisationId: string, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, disabledAt: true, emailVerifiedAt: true, accountRole: true } });
  // Issuing an invitation also needs a verified address.
  if (!user || !user.emailVerifiedAt) return null;
  const role = await liveStaffRole(db, organisationId, user);
  return roleHasPermission(role, "staff:manage") ? role : null;
}
