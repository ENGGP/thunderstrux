import type { Prisma } from "@prisma/client";
import { hasOrganisationPermission } from "@/lib/permissions";

// Database-only authority: notification workers must not load HTTP auth/CSRF.
export async function invitationIssuerRole(db: Prisma.TransactionClient, organisationId: string, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { disabledAt: true, emailVerifiedAt: true, accountRole: true } });
  if (!user || user.disabledAt || !user.emailVerifiedAt) return null;
  const staff = await db.organisationStaff.findUnique({ where: { organisationId_userId: { organisationId, userId } } });
  if (staff) return staff.status === "active" && hasOrganisationPermission(staff.role, "staff:manage") ? staff.role : null;
  const legacy = process.env.LEGACY_ORGANISATION_ACCESS_MODE ?? (process.env.NODE_ENV === "production" ? "deny" : "allow");
  if (legacy !== "allow" || user.accountRole !== "organisation") return null;
  const organisation = await db.organisation.findUnique({ where: { id: organisationId }, select: { accountUserId: true } });
  return organisation?.accountUserId === userId ? "owner" as const : null;
}
