import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  hasOrganisationPermission,
  organisationRolesWithPermission,
  type OrganisationPermission,
  type OrganisationRole
} from "@/lib/permissions";
import type { OrganisationStaffRole } from "@/lib/permissions";

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

export type OrganisationManagementContext = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  staffRole: OrganisationStaffRole;
};

export async function requireAuthenticatedUser() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    throw new AuthenticationRequiredError();
  }

  return {
    id: userId,
    accountRole: session.user.accountRole ?? "member",
    email: session.user.email
  };
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

  if (staff) return user;

  // Unrelated staff memberships must not hide legacy ownership. Any staff row
  // for the owned tenant supersedes that legacy authority, including revocation.
  if (user.accountRole === "organisation") {
    const legacyOwner = await prisma.organisation.findFirst({
      where: {
        accountUserId: user.id,
        staff: { none: { userId: user.id } }
      },
      select: { id: true }
    });
    if (legacyOwner) return user;
  }

  throw new OrganisationAccessError("Insufficient permissions");
}

export async function getCurrentOrganisationAccount() {
  const user = await requireAuthenticatedUser();

  const staff = await prisma.organisationStaff.findFirst({
    where: {
      userId: user.id,
      status: "active"
    },
    orderBy: [
      {
        role: "asc"
      },
      {
        createdAt: "asc"
      }
    ],
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

  if (staff) {
    return {
      ...staff.organisation,
      staffRole: staff.role as OrganisationStaffRole
    };
  }

  if (user.accountRole !== "organisation") {
    return null;
  }

  const organisation = await prisma.organisation.findUnique({
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

  if (organisation) {
    const existingStaffAuthority = await prisma.organisationStaff.findUnique({
      where: {
        organisationId_userId: {
          organisationId: organisation.id,
          userId: user.id
        }
      },
      select: { id: true }
    });

    if (existingStaffAuthority) {
      return null;
    }
  }

  return organisation
    ? {
        ...organisation,
        staffRole: "owner" as OrganisationStaffRole
      }
    : null;
}

export async function requireCurrentOrganisationAccount() {
  const organisation = await getCurrentOrganisationAccount();

  if (!organisation) {
    throw new OrganisationAccessError("Organisation account has no organisation");
  }

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

  return memberships.map((membership) => ({
    ...membership.organisation,
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

  if (staffRows.length > 0) {
    return staffRows.map((staff) => ({
      ...staff.organisation,
      staffRole: staff.role as OrganisationStaffRole
    }));
  }

  if (user.accountRole !== "organisation") {
    return [];
  }

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

  if (legacyOrganisation) {
    const existingStaffAuthority = await prisma.organisationStaff.findUnique({
      where: {
        organisationId_userId: {
          organisationId: legacyOrganisation.id,
          userId: user.id
        }
      },
      select: { id: true }
    });

    if (existingStaffAuthority) {
      return [];
    }
  }

  return legacyOrganisation
    ? [
        {
          ...legacyOrganisation,
          staffRole: "owner" as OrganisationStaffRole
        }
      ]
    : [];
}

export async function getOrganisationAccessForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountRole: true }
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

    return organisation
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

  const staff = await prisma.organisationStaff.findFirst({
    where: {
      userId: user.id,
      status: "active",
      organisation: {
        slug: orgSlug
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

  if (staff) {
    return {
      ...staff.organisation,
      role: staff.role as unknown as OrganisationRole
    };
  }

  if (user.accountRole === "organisation") {
    const organisation = await prisma.organisation.findFirst({
      where: {
        slug: orgSlug,
        accountUserId: user.id
      },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true
      }
    });

    if (!organisation) {
      throw new OrganisationAccessError("Organisation not found or access denied");
    }

    return {
      ...organisation,
      role: "org_owner" as OrganisationRole
    };
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

export async function requireOrganisationAccessById(organisationId: string) {
  const user = await requireAuthenticatedUser();

  const staff = await prisma.organisationStaff.findFirst({
    where: {
      userId: user.id,
      status: "active",
      organisationId
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

  if (staff) {
    return {
      ...staff.organisation,
      role: staff.role as unknown as OrganisationRole
    };
  }

  if (user.accountRole === "organisation") {
    const organisation = await prisma.organisation.findFirst({
      where: {
        id: organisationId,
        accountUserId: user.id
      },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true
      }
    });

    if (!organisation) {
      throw new OrganisationAccessError("Organisation not found or access denied");
    }

    return {
      ...organisation,
      role: "org_owner" as OrganisationRole
    };
  }

  // Member accounts can view joined organisations. OrganisationMember rows do
  // not grant management authority in the current account model.
  const membership = await prisma.organisationMember.findUnique({
    where: {
      userId_organisationId: {
        userId: user.id,
        organisationId
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

  if (!membership) {
    throw new OrganisationAccessError("Organisation not found or access denied");
  }

  return {
    ...membership.organisation,
    role: membership.role as OrganisationRole
  };
}

export async function requireOrganisationPermission(
  organisationId: string,
  permission: OrganisationPermission
) {
  const user = await requireAuthenticatedUser();

  const staff = await prisma.organisationStaff.findFirst({
    where: {
      organisationId,
      userId: user.id,
      status: "active"
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

  if (!staff) {
    if (user.accountRole === "organisation") {
      const legacyOrganisation = await prisma.organisation.findFirst({
        where: {
          id: organisationId,
          accountUserId: user.id
        },
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true
        }
      });

      if (legacyOrganisation) {
        const existingStaffAuthority = await prisma.organisationStaff.findUnique({
          where: {
            organisationId_userId: {
              organisationId,
              userId: user.id
            }
          },
          select: { id: true }
        });

        if (existingStaffAuthority) {
          throw new OrganisationAccessError("Organisation not found or access denied");
        }
      }

      if (legacyOrganisation && hasOrganisationPermission("owner", permission)) {
        return {
          ...legacyOrganisation,
          staffRole: "owner" as OrganisationStaffRole
        };
      }
    }

    throw new OrganisationAccessError("Organisation not found or access denied");
  }

  if (!hasOrganisationPermission(staff.role as OrganisationStaffRole, permission)) {
    throw new OrganisationAccessError("Insufficient staff permissions");
  }

  return {
    ...staff.organisation,
    staffRole: staff.role as OrganisationStaffRole
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
      if (error instanceof OrganisationAccessError) {
        lastAccessError = error;
        continue;
      }

      throw error;
    }
  }

  throw lastAccessError ?? new OrganisationAccessError("Organisation access denied");
}

export async function requireOrganisationStaffAccess(organisationId: string) {
  return requireOrganisationPermission(organisationId, "events:manage");
}

export async function requireOrganisationAdminAccess(organisationId: string) {
  return requireOrganisationPermission(organisationId, "staff:manage");
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
