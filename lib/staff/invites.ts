import { createHash, randomBytes } from "node:crypto";
import type { OrganisationStaffRole, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { lockAccount, type AccountActor } from "@/lib/auth/account-lifecycle";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import { invitationIssuerRole } from "./invite-authority";
import { mfaEnforcementMode } from "@/lib/security/staff-mfa";
import { mfaGrantDigest } from "@/lib/security/csrf";

export class StaffInviteError extends Error {
  constructor(message = "Invitation is unavailable", readonly kind: "invalid" | "authority" | "stale_session" | "conflict" = "invalid") { super(message); }
}
export function hashStaffInviteToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function createStaffInviteToken() { return randomBytes(32).toString("base64url"); }
export function defaultStaffInviteExpiry(now = new Date()) { return new Date(now.getTime() + 7 * 86400000); }
const inviteSelect = { id: true, email: true, role: true, expiresAt: true, createdAt: true, version: true } as const;

async function lockUsers(tx: Prisma.TransactionClient, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) await lockAccount(tx, id);
}
async function liveRecipient(tx: Prisma.TransactionClient, actor: AccountActor) {
  const user = await tx.user.findUnique({ where: { id: actor.id } });
  if (!user || user.disabledAt || user.authVersion !== actor.authVersion) throw new StaffInviteError("Sign in again to continue", "stale_session");
  if (!user.emailVerifiedAt) throw new StaffInviteError("Verify your email before accepting staff access", "authority");
  return user;
}
async function liveIssuer(tx: Prisma.TransactionClient, actor: AccountActor, organisationId: string, role: OrganisationStaffRole, now: Date) {
  const user = await liveRecipient(tx, actor);
  const authority = await invitationIssuerRole(tx, organisationId, actor.id);
  if (!authority || (role === "owner" && authority !== "owner")) throw new StaffInviteError("Only authorised owners or admins can manage this invitation", "authority");
  const mode = mfaEnforcementMode();
  if (mode !== "off") {
    const enrollment = await tx.userMfa.findUnique({ where: { userId: user.id }, select: { enabledAt: true } });
    const digest = mfaGrantDigest(actor.mfaSessionId);
    const grant = digest ? await tx.mfaGrant.findFirst({ where: { userId: user.id, sessionDigest: digest, expiresAt: { gt: now }, verifiedAt: { lte: now } } }) : null;
    if ((!enrollment?.enabledAt && mode === "enforce") || (enrollment?.enabledAt && !grant)) throw new StaffInviteError("Staff authenticator verification required", "authority");
  }
  return authority;
}
async function lockOrganisation(tx: Prisma.TransactionClient, organisationId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${organisationId} FOR UPDATE`;
  const organisation = await tx.organisation.findUnique({ where: { id: organisationId } });
  if (!organisation) throw new StaffInviteError();
  return organisation;
}
async function cancelMessages(tx: Prisma.TransactionClient, inviteId: string) {
  await tx.notificationOutbox.updateMany({ where: { staffInviteId: inviteId, status: { in: ["pending", "processing"] } }, data: {
    status: "cancelled", processingToken: null, lastError: "obsolete_invite"
  } });
}
async function enqueueInvite(tx: Prisma.TransactionClient, invite: { id: string; email: string; role: OrganisationStaffRole; version: number; expiresAt: Date }, organisationName: string, token: string) {
  const link = new URL("/staff/invites/accept", process.env.NEXT_PUBLIC_APP_URL);
  link.hash = new URLSearchParams({ token }).toString();
  await enqueueNotification(tx, { eventKey: `staff-invite/${invite.id}/${invite.version}`, recipient: invite.email, template: "staff_invite",
    staffInviteId: invite.id, staffInviteVersion: invite.version, expiresAt: invite.expiresAt,
    payload: { message: `You are invited to join ${organisationName} as ${invite.role.replace(/_/g, " ")}. Sign in with this email and verify it, then explicitly accept. This link expires in seven days. Existing active staff roles are preserved.`, link: link.toString() } });
}
async function audit(tx: Prisma.TransactionClient, organisationId: string, actorId: string, inviteId: string, action: string, metadata: Prisma.InputJsonObject) {
  await tx.auditLog.create({ data: { organisationId, actorUserId: actorId, action, targetType: "OrganisationStaffInvite", targetId: inviteId, metadata } });
}
async function recipientSnapshot(email: string) {
  return prisma.user.findUnique({ where: { email }, select: { id: true } });
}
async function recheckRecipient(tx: Prisma.TransactionClient, email: string, candidate: { id: string } | null) {
  const current = await tx.user.findUnique({ where: { email }, select: { id: true, disabledAt: true } });
  if (current?.id !== candidate?.id || current?.disabledAt) throw new StaffInviteError("Recipient changed; review the invitation and try again", "conflict");
  return current;
}
export async function createOrganisationStaffInvite(input: { organisationId: string; actor: AccountActor; email: string; role: OrganisationStaffRole; now?: Date }) {
  const now = input.now ?? new Date(); const email = input.email.trim().toLowerCase();
  const recipient = await recipientSnapshot(email);
  return prisma.$transaction(async tx => {
    await lockUsers(tx, [input.actor.id, ...(recipient ? [recipient.id] : [])]);
    await recheckRecipient(tx, email, recipient);
    const organisation = await lockOrganisation(tx, input.organisationId);
    const authority = await liveIssuer(tx, input.actor, organisation.id, input.role, now);
    const existing = recipient ? await tx.organisationStaff.findUnique({ where: { organisationId_userId: { organisationId: organisation.id, userId: recipient.id } } }) : null;
    if (existing?.role === "owner" && existing.status !== "active" && authority !== "owner") throw new StaffInviteError("Only owners can change owner authority", "authority");
    const token = createStaffInviteToken();
    const invite = await tx.organisationStaffInvite.create({ data: { organisationId: organisation.id, invitedById: input.actor.id, email, role: input.role,
      tokenHash: hashStaffInviteToken(token), expiresAt: defaultStaffInviteExpiry(now) }, select: inviteSelect });
    await enqueueInvite(tx, invite, organisation.name, token);
    await audit(tx, organisation.id, input.actor.id, invite.id, "staff.invite.created", { role: invite.role, version: invite.version });
    return { invite };
  }, { timeout: 15000 });
}
export async function manageOrganisationStaffInvite(actor: AccountActor, organisationId: string, inviteId: string, action: "resend" | "revoke", now = new Date()) {
  const snapshot = await prisma.organisationStaffInvite.findFirst({ where: { id: inviteId, organisationId } });
  if (!snapshot) throw new StaffInviteError();
  const recipient = await recipientSnapshot(snapshot.email);
  return prisma.$transaction(async tx => {
    await lockUsers(tx, [actor.id, snapshot.invitedById, ...(recipient ? [recipient.id] : [])]);
    if (action === "resend") await recheckRecipient(tx, snapshot.email, recipient);
    const organisation = await lockOrganisation(tx, organisationId);
    await tx.$queryRaw`SELECT "id" FROM "OrganisationStaffInvite" WHERE "id" = ${inviteId} FOR UPDATE`;
    const existing = await tx.organisationStaffInvite.findFirst({ where: { id: inviteId, organisationId } });
    if (!existing || existing.invitedById !== snapshot.invitedById || existing.version !== snapshot.version || existing.acceptedAt || existing.revokedAt) throw new StaffInviteError();
    await liveIssuer(tx, actor, organisationId, existing.role, now);
    await cancelMessages(tx, inviteId);
    if (action === "revoke") {
      const invite = await tx.organisationStaffInvite.update({ where: { id: inviteId }, data: { revokedAt: now }, select: inviteSelect });
      await audit(tx, organisationId, actor.id, inviteId, "staff.invite.revoked", { version: existing.version });
      return { invite };
    }
    const token = createStaffInviteToken();
    const invite = await tx.organisationStaffInvite.update({ where: { id: inviteId }, data: { version: { increment: 1 }, invitedById: actor.id,
      tokenHash: hashStaffInviteToken(token), expiresAt: defaultStaffInviteExpiry(now) }, select: inviteSelect });
    await enqueueInvite(tx, invite, organisation.name, token);
    await audit(tx, organisationId, actor.id, inviteId, "staff.invite.resent", { version: invite.version });
    return { invite };
  }, { timeout: 15000 });
}
export async function acceptOrganisationStaffInvite(input: { token: string; actor: AccountActor; now?: Date }) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.token)) throw new StaffInviteError();
  const now = input.now ?? new Date(); const tokenHash = hashStaffInviteToken(input.token);
  const snapshot = await prisma.organisationStaffInvite.findUnique({ where: { tokenHash } });
  if (!snapshot) throw new StaffInviteError();
  return prisma.$transaction(async tx => {
    await lockUsers(tx, [input.actor.id, snapshot.invitedById]);
    const user = await liveRecipient(tx, input.actor);
    await lockOrganisation(tx, snapshot.organisationId);
    await tx.$queryRaw`SELECT "id" FROM "OrganisationStaffInvite" WHERE "id" = ${snapshot.id} FOR UPDATE`;
    const invite = await tx.organisationStaffInvite.findUnique({ where: { tokenHash } });
    if (!invite || invite.id !== snapshot.id || invite.version !== snapshot.version || invite.invitedById !== snapshot.invitedById) throw new StaffInviteError();
    const key = { organisationId: invite.organisationId, userId: user.id };
    const existing = await tx.organisationStaff.findUnique({ where: { organisationId_userId: key } });
    const select = { id: true, organisationId: true, role: true, status: true } as const;
    if (invite.acceptedAt) {
      if (invite.acceptedById !== user.id || !existing) throw new StaffInviteError();
      const staff = await tx.organisationStaff.findUniqueOrThrow({ where: { organisationId_userId: key }, select });
      return { inviteId: invite.id, staff, alreadyAccepted: true };
    }
    if (invite.email !== user.email || invite.revokedAt || invite.expiresAt <= now) throw new StaffInviteError();
    const issuer = await invitationIssuerRole(tx, invite.organisationId, invite.invitedById);
    if (!issuer || (invite.role === "owner" && issuer !== "owner") || (existing?.role === "owner" && existing.status !== "active" && issuer !== "owner")) throw new StaffInviteError();
    const preserved = existing?.status === "active";
    const staff = preserved ? await tx.organisationStaff.findUniqueOrThrow({ where: { organisationId_userId: key }, select }) :
      await tx.organisationStaff.upsert({ where: { organisationId_userId: key }, update: { role: invite.role, status: "active", acceptedAt: now, revokedAt: null, revokedById: null },
        create: { ...key, role: invite.role, status: "active", acceptedAt: now }, select });
    const consumed = await tx.organisationStaffInvite.updateMany({ where: { id: invite.id, version: invite.version, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { acceptedAt: now, acceptedById: user.id } });
    if (consumed.count !== 1) throw new StaffInviteError();
    await cancelMessages(tx, invite.id);
    await audit(tx, invite.organisationId, user.id, invite.id, "staff.invite.accepted", { staffId: staff.id, role: staff.role, version: invite.version, existingRolePreserved: preserved });
    return { inviteId: invite.id, staff, alreadyAccepted: false };
  }, { timeout: 15000 });
}
