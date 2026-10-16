import type { Prisma } from "@prisma/client";
import { hasOrganisationPermission, type OrganisationPermission, type OrganisationStaffRole } from "@/lib/permissions";

// The one live staff authority rule (AUTHZ-001), shared by routes, services and
// workers. Database-only: it never loads HTTP auth, session or CSRF modules.

// LEGACY_ORGANISATION_ACCESS_MODE decides whether an organisation account still
// named on the legacy Organisation.accountUserId pointer may act as its owner.
// Unset means allow in development; in production, unset or invalid denies, and
// readiness reports it (assertLegacyOrganisationAccessConfigured).
export function legacyOrganisationAccessMode(): "allow" | "deny" {
  const value = process.env.LEGACY_ORGANISATION_ACCESS_MODE;
  if (value === "allow" || value === "deny") return value;
  return !value && process.env.NODE_ENV !== "production" ? "allow" : "deny";
}

export function assertLegacyOrganisationAccessConfigured() {
  const value = process.env.LEGACY_ORGANISATION_ACCESS_MODE;
  const valid = value === "allow" || value === "deny" || (!value && process.env.NODE_ENV !== "production");
  if (!valid) throw new Error("LEGACY_ORGANISATION_ACCESS_MODE must be set to allow or deny");
}

type AuthorityClient = Pick<Prisma.TransactionClient, "user" | "organisation" | "organisationStaff">;
export type AuthorityActor = { id: string; accountRole: string; disabledAt?: Date | null };

// The actor's live role in one organisation, or null:
// - an active staff row grants its role;
// - any staff row for the organisation, active or not, supersedes legacy ownership;
// - otherwise an organisation account on the legacy pointer is owner when the mode allows it;
// - a disabled account holds no authority.
export async function liveStaffRole(
  db: AuthorityClient,
  organisationId: string,
  actor: AuthorityActor
): Promise<OrganisationStaffRole | null> {
  if (actor.disabledAt) return null;
  const staff = await db.organisationStaff.findUnique({
    where: { organisationId_userId: { organisationId, userId: actor.id } },
    select: { role: true, status: true }
  });
  if (staff) return staff.status === "active" ? staff.role : null;
  if (actor.accountRole !== "organisation" || legacyOrganisationAccessMode() !== "allow") return null;
  const organisation = await db.organisation.findUnique({ where: { id: organisationId }, select: { accountUserId: true } });
  return organisation?.accountUserId === actor.id ? "owner" : null;
}

// For callers that hold only a user id (workers, review actions): loads the live account first.
export async function liveStaffRoleForUser(db: AuthorityClient, organisationId: string, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, accountRole: true, disabledAt: true } });
  return user ? liveStaffRole(db, organisationId, user) : null;
}

export function roleHasPermission(role: OrganisationStaffRole | null, permission: OrganisationPermission) {
  return role !== null && hasOrganisationPermission(role, permission);
}
