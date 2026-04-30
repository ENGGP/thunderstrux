import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  canManageEvents,
  canManageFinance,
  canManageStripeConnect,
  type OrganisationRole
} from "@/lib/permissions";

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

export async function getCurrentOrganisationAccount() {
  const user = await requireAccountRole("organisation");

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

  return organisation
    ? {
        ...organisation,
        role: "org_owner" as OrganisationRole
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
    return organisation ? [organisation] : [];
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

  // Organisation accounts access their organisation through ownership
  // (`Organisation.accountUserId`), not through OrganisationMember.
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

  // Organisation accounts access their organisation through ownership
  // (`Organisation.accountUserId`), not through OrganisationMember.
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

async function requireOwnedOrganisationById(organisationId: string) {
  const user = await requireAuthenticatedUser();

  if (user.accountRole !== "organisation") {
    throw new OrganisationAccessError("Organisation account required");
  }

  // Management authority comes from owning the organisation account, not from
  // OrganisationMember. This keeps member joins from escalating to staff access.
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

async function requireOrganisationRoleAccess(
  organisationId: string,
  allowedRoles: OrganisationRole[],
  errorMessage: string
) {
  const user = await requireAuthenticatedUser();

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

    if (!organisation || !allowedRoles.includes("org_owner")) {
      throw new OrganisationAccessError(errorMessage);
    }

    return {
      ...organisation,
      role: "org_owner" as OrganisationRole
    };
  }

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

  if (!membership || !allowedRoles.includes(membership.role as OrganisationRole)) {
    throw new OrganisationAccessError(errorMessage);
  }

  return {
    ...membership.organisation,
    role: membership.role as OrganisationRole
  };
}

export async function requireOrganisationStaffAccess(organisationId: string) {
  return requireOrganisationRoleAccess(
    organisationId,
    [
      "org_owner",
      "org_admin",
      "event_manager",
      "finance_manager",
      "content_manager"
    ],
    "Insufficient staff permissions"
  );
}

export async function requireOrganisationAdminAccess(organisationId: string) {
  return requireOrganisationRoleAccess(
    organisationId,
    ["org_owner", "org_admin"],
    "Insufficient admin permissions"
  );
}

export async function requireOrganisationEventManagementAccess(organisationId: string) {
  const organisation = await requireOwnedOrganisationById(organisationId);

  if (!canManageEvents(organisation.role)) {
    throw new OrganisationAccessError("Insufficient event permissions");
  }

  return organisation;
}

export async function requireOrganisationFinanceAccess(organisationId: string) {
  const organisation = await requireOwnedOrganisationById(organisationId);

  if (!canManageFinance(organisation.role)) {
    throw new OrganisationAccessError("Insufficient finance permissions");
  }

  return organisation;
}

export async function requireOrganisationStripeConnectAccess(organisationId: string) {
  const organisation = await requireOwnedOrganisationById(organisationId);

  if (!canManageStripeConnect(organisation.role)) {
    throw new OrganisationAccessError("Insufficient Stripe Connect permissions");
  }

  return organisation;
}
