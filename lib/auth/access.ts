import { getLiveSession } from "@/lib/auth/live-session";
import { prisma } from "@/lib/db";
import { readAccountContext } from "./context";
import { mfaGrantDigest } from "@/lib/security/csrf";
import { MfaRequiredError, mfaEnforcementMode, requireStaffMfa } from "@/lib/security/staff-mfa";
import {
  hasOrganisationPermission,
  organisationRolesWithPermission,
  type OrganisationPermission,
  type OrganisationRole
} from "@/lib/permissions";
import type { OrganisationStaffRole } from "@/lib/permissions";
import { legacyOrganisationAccessMode, liveStaffRole, roleHasPermission } from "@/lib/staff/live-authority";

export { legacyOrganisationAccessMode };

export type AccountRole = "member" | "organisation";

export class AuthenticationRequiredError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

export class OrganisationAccessError extends Error {
  constructor(message = "Organisation access denied") {
    super(message);
    this.name = "OrganisationAccessError";
  }
}

export class StaffMfaRequiredError extends OrganisationAccessError {
  constructor(message: string) {
    super(message);
    this.name = "StaffMfaRequiredError";
  }
}

async function requireCurrentStaffMfa(user: { id: string; mfaSessionId?: string }) {
  if (mfaEnforcementMode() === "off") return;
  try {
    await requireStaffMfa(user.id, mfaGrantDigest(user.mfaSessionId));
  } catch (error) {
    if (error instanceof MfaRequiredError) throw new StaffMfaRequiredError(error.message);
    throw error;
  }
}

export type OrganisationManagementContext = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  staffRole: OrganisationStaffRole;
};

export async function requireAuthenticatedUser() {
  const session = await getLiveSession();
  const userId = session?.user?.id;

  if (!userId) {
    throw new AuthenticationRequiredError();
  }

  const liveUser = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, accountRole: true, disabledAt: true, emailVerifiedAt: true, authVersion: true } });
  if (!liveUser || liveUser.disabledAt || liveUser.authVersion !== session.user.authVersion) throw new AuthenticationRequiredError();

  return {
    id: userId,
    authVersion: liveUser.authVersion,
    mfaSessionId: session.user.staffMfaSessionId,
    accountRole: liveUser.accountRole,
    email: liveUser.email,
    emailVerifiedAt: liveUser.emailVerifiedAt
  };
}

export async function requireVerifiedUser() {
  const user = await requireAuthenticatedUser();
  if (!user.emailVerifiedAt) throw new OrganisationAccessError("Verify your email before using this feature");
  return user;
}

export async function requireAccountRole(accountRole: AccountRole) {
  const user = await requireAuthenticatedUser();

  if (user.accountRole !== accountRole) {
    throw new OrganisationAccessError("Account role is not allowed for this action");
  }

  return user;
}

// Broad capability only: callers must still authorise the requested tenant.
export async function requireStripeConnectCapability() {
  const user = await requireAuthenticatedUser();
  const staff = await prisma.organisationStaff.findFirst({
    where: {
      userId: user.id,
      status: "active",
      role: { in: organisationRolesWithPermission("stripe:manage") }
    },
    select: { id: true }
  });

  if (staff) {
    await requireCurrentStaffMfa(user);
    return user;
  }

  // Unrelated staff memberships must not hide legacy ownership; the shared rule
  // lets any staff row for the owned tenant supersede it, including revocation.
  const legacyOrganisation = await prisma.organisation.findUnique({ where: { accountUserId: user.id }, select: { id: true } });
  if (legacyOrganisation && roleHasPermission(await liveStaffRole(prisma, legacyOrganisation.id, user), "stripe:manage")) {
    await requireCurrentStaffMfa(user);
    return user;
  }

  throw new OrganisationAccessError("Insufficient permissions");
}

export async function getCurrentOrganisationAccount() {
  return (await readAccountContext()).selected;
}

export async function requireCurrentOrganisationAccount() {
  const organisation = await getCurrentOrganisationAccount();

  if (!organisation) {
    throw new OrganisationAccessError("Organisation account has no organisation");
  }

  const user = await requireAuthenticatedUser();
  await requireCurrentStaffMfa(user);

  return organisation;
}

export async function getAccessibleOrganisationsForCurrentAccount() {
  const user = await requireAuthenticatedUser();

  if (user.accountRole === "organisation") {
    const organisation = await getCurrentOrganisationAccount();
    return organisation
      ? [
          {
            id: organisation.id,
            name: organisation.name,
            slug: organisation.slug,
            createdAt: organisation.createdAt,
            joinedAt: null as Date | null,
            memberUntil: null as Date | null,
            timeZone: null as string | null,
            role: "org_owner" as OrganisationRole
          }
        ]
      : [];
  }

  // Member accounts discover their joined organisations from OrganisationMember.
  // Those rows are member join state, not organisation management authority.
  const memberships = await prisma.organisationMember.findMany({
    where: {
      userId: user.id
    },
    orderBy: {
      organisation: {
        name: "asc"
      }
    },
    select: {
      role: true,
      createdAt: true,
      organisation: {
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
          timeZone: true
        }
      }
    }
  });
  // A running membership is shown beside the join, as its own badge (T24a).
  const now = new Date();
  const running = await prisma.membershipGrant.findMany({
    where: { userId: user.id, revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now }, organisationId: { in: memberships.map((row) => row.organisation.id) } },
    select: { organisationId: true, endsAt: true }
  });
  const memberUntil = (organisationId: string) =>
    running.filter((grant) => grant.organisationId === organisationId).reduce<Date | null>((latest, grant) => (!latest || grant.endsAt > latest ? grant.endsAt : latest), null);

  return memberships.map((membership) => ({
    ...membership.organisation,
    joinedAt: membership.createdAt as Date | null,
    memberUntil: memberUntil(membership.organisation.id),
    role: membership.role as OrganisationRole
  }));
}

export async function getCurrentStaffOrganisations() {
  const user = await requireAuthenticatedUser();

  const staffRows = await prisma.organisationStaff.findMany({
    where: {
      userId: user.id,
      status: "active"
    },
    orderBy: {
      organisation: {
        name: "asc"
      }
    },
    select: {
      role: true,
      organisation: {
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true
        }
      }
    }
  });

  const result = staffRows.map(staff => ({ ...staff.organisation, staffRole: staff.role as OrganisationStaffRole }));
  if (user.accountRole !== "organisation") return result;

  const legacyOrganisation = await prisma.organisation.findUnique({
    where: {
      accountUserId: user.id
    },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true
    }
  });

  if (legacyOrganisation && !result.some((organisation) => organisation.id === legacyOrganisation.id) &&
      await liveStaffRole(prisma, legacyOrganisation.id, user) === "owner") {
    result.push({ ...legacyOrganisation, staffRole: "owner" });
  }
  return result;
}

export async function getOrganisationAccessForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, accountRole: true, disabledAt: true }
  });

  if (user?.accountRole === "organisation") {
    const organisation = await prisma.organisation.findUnique({
      where: { accountUserId: userId },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true
      }
    });

    return organisation && await liveStaffRole(prisma, organisation.id, user)
      ? [
          {
            role: "org_owner" as OrganisationRole,
            organisation
          }
        ]
      : [];
  }

  // OrganisationMember represents member join state only. It is not used to
  // grant organisation management authority.
  return prisma.organisationMember.findMany({
    where: { userId },
    orderBy: {
      organisation: {
        name: "asc"
      }
    },
    select: {
      role: true,
      organisation: {
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true
        }
      }
    }
  });
}

export function mapOrganisationAccessToOrganisations(
  accessRows: Awaited<ReturnType<typeof getOrganisationAccessForUser>>
) {
  return accessRows.map((accessRow) => ({
    ...accessRow.organisation,
    role: accessRow.role as OrganisationRole
  }));
}

export async function requireOrganisationAccessBySlug(orgSlug: string) {
  const user = await requireAuthenticatedUser();

  const target = await prisma.organisation.findUnique({
    where: { slug: orgSlug },
    select: { id: true, name: true, slug: true, createdAt: true }
  });
  const staffRole = target ? await liveStaffRole(prisma, target.id, user) : null;

  if (target && staffRole) {
    return {
      ...target,
      role: staffRole as unknown as OrganisationRole
    };
  }

  if (user.accountRole === "organisation") {
    throw new OrganisationAccessError("Organisation not found or access denied");
  }

  // Member accounts can view organisations they have joined. This membership
  // path is intentionally separate from management authority.
  const organisation = await prisma.organisation.findFirst({
    where: {
      slug: orgSlug,
      members: {
        some: {
          userId: user.id
        }
      }
    },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      members: {
        where: { userId: user.id },
        select: { role: true },
        take: 1
      }
    }
  });

  if (!organisation) {
    throw new OrganisationAccessError("Organisation not found or access denied");
  }

  return {
    id: organisation.id,
    name: organisation.name,
    slug: organisation.slug,
    createdAt: organisation.createdAt,
    role: organisation.members[0]?.role as OrganisationRole
  };
}

export async function requireOrganisationPermission(
  organisationId: string,
  permission: OrganisationPermission
) {
  const user = await requireAuthenticatedUser();

  const staffRole = await liveStaffRole(prisma, organisationId, user);

  if (!staffRole) {
    throw new OrganisationAccessError("Organisation not found or access denied");
  }

  if (!hasOrganisationPermission(staffRole, permission)) {
    throw new OrganisationAccessError("Insufficient staff permissions");
  }

  await requireCurrentStaffMfa(user);

  const organisation = await prisma.organisation.findUniqueOrThrow({
    where: { id: organisationId },
    select: { id: true, name: true, slug: true, createdAt: true }
  });

  return {
    ...organisation,
    staffRole
  };
}

export async function requireAnyOrganisationPermission(
  organisationId: string,
  permissions: OrganisationPermission[]
) {
  let lastAccessError: OrganisationAccessError | null = null;

  for (const permission of permissions) {
    try {
      return await requireOrganisationPermission(organisationId, permission);
    } catch (error) {
      if (error instanceof StaffMfaRequiredError) throw error;
      if (error instanceof OrganisationAccessError) {
        lastAccessError = error;
        continue;
      }

      throw error;
    }
  }

  throw lastAccessError ?? new OrganisationAccessError("Organisation access denied");
}

export async function requireOrganisationEventManagementAccess(organisationId: string) {
  return requireOrganisationPermission(organisationId, "events:manage");
}

export async function requireOrganisationFinanceAccess(organisationId: string) {
  return requireOrganisationPermission(organisationId, "orders:read");
}

export async function requireOrganisationStripeConnectAccess(organisationId: string) {
  return requireOrganisationPermission(organisationId, "stripe:manage");
}
