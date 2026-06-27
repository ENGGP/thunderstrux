import { createHash, randomBytes } from "node:crypto";
import type { OrganisationStaffRole } from "@prisma/client";
import { prisma } from "@/lib/db";

export class StaffInviteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffInviteError";
  }
}

export function hashStaffInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createStaffInviteToken() {
  return randomBytes(32).toString("base64url");
}

export function defaultStaffInviteExpiry(now = new Date()) {
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
}

export async function createOrganisationStaffInvite({
  organisationId,
  invitedById,
  email,
  role,
  now = new Date()
}: {
  organisationId: string;
  invitedById: string;
  email: string;
  role: OrganisationStaffRole;
  now?: Date;
}) {
  const token = createStaffInviteToken();
  const invite = await prisma.organisationStaffInvite.create({
    data: {
      organisationId,
      invitedById,
      email: email.trim().toLowerCase(),
      role,
      tokenHash: hashStaffInviteToken(token),
      expiresAt: defaultStaffInviteExpiry(now)
    },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      createdAt: true
    }
  });

  return { invite, token };
}

export async function acceptOrganisationStaffInvite({
  token,
  userId,
  userEmail,
  now = new Date()
}: {
  token: string;
  userId: string;
  userEmail: string | null | undefined;
  now?: Date;
}) {
  const tokenHash = hashStaffInviteToken(token);
  const normalisedEmail = userEmail?.trim().toLowerCase();

  if (!normalisedEmail) {
    throw new StaffInviteError("Signed-in user email is required");
  }

  return prisma.$transaction(async (tx) => {
    const invite = await tx.organisationStaffInvite.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        organisationId: true,
        email: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true
      }
    });

    if (!invite) {
      throw new StaffInviteError("Invite was not found");
    }

    if (invite.revokedAt) {
      throw new StaffInviteError("Invite has been revoked");
    }

    if (invite.acceptedAt) {
      throw new StaffInviteError("Invite has already been accepted");
    }

    if (invite.expiresAt <= now) {
      throw new StaffInviteError("Invite has expired");
    }

    if (invite.email !== normalisedEmail) {
      throw new StaffInviteError("Invite email does not match signed-in user");
    }

    const staff = await tx.organisationStaff.upsert({
      where: {
        organisationId_userId: {
          organisationId: invite.organisationId,
          userId
        }
      },
      update: {
        role: invite.role,
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        revokedById: null
      },
      create: {
        organisationId: invite.organisationId,
        userId,
        role: invite.role,
        status: "active",
        acceptedAt: now
      },
      select: {
        id: true,
        organisationId: true,
        role: true,
        status: true
      }
    });

    await tx.organisationStaffInvite.update({
      where: { id: invite.id },
      data: {
        acceptedAt: now,
        acceptedById: userId
      }
    });

    return {
      inviteId: invite.id,
      staff
    };
  });
}
