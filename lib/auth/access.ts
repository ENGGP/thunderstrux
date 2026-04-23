import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  canManageEvents,
  canManageFinance,
  canManageStripeConnect,
  type OrganisationRole
} from "@/lib/permissions";

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

  return { id: userId, email: session.user.email };
}

export async function getMemberOrganisations() {
  const user = await requireAuthenticatedUser();

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

export async function getOrganisationMembershipsForUser(userId: string) {
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

export function mapMembershipsToOrganisations(
  memberships: Awaited<ReturnType<typeof getOrganisationMembershipsForUser>>
) {
  return memberships.map((membership) => ({
    ...membership.organisation,
    role: membership.role as OrganisationRole
  }));
}

export async function requireOrganisationMembershipBySlug(orgSlug: string) {
  const user = await requireAuthenticatedUser();
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

export async function requireOrganisationMembershipById(organisationId: string) {
  const user = await requireAuthenticatedUser();
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

export async function requireEventManagementAccess(organisationId: string) {
  const organisation = await requireOrganisationMembershipById(organisationId);

  if (!canManageEvents(organisation.role)) {
    throw new OrganisationAccessError("Insufficient event permissions");
  }

  return organisation;
}

export async function requireFinanceAccess(organisationId: string) {
  const organisation = await requireOrganisationMembershipById(organisationId);

  if (!canManageFinance(organisation.role)) {
    throw new OrganisationAccessError("Insufficient finance permissions");
  }

  return organisation;
}

export async function requireStripeConnectAccess(organisationId: string) {
  const organisation = await requireOrganisationMembershipById(organisationId);

  if (!canManageStripeConnect(organisation.role)) {
    throw new OrganisationAccessError("Insufficient Stripe Connect permissions");
  }

  return organisation;
}
