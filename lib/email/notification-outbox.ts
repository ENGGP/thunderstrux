import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encryptNotification, decryptNotification } from "./notification-crypto";
import { notificationTemplateSchema, renderNotification, renderedNotificationSchema, type NotificationTemplate } from "./templates";
import { sendWithResend } from "./ticket-delivery";
import { logInfo } from "@/lib/ops/logger";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { hasOrganisationPermission } from "@/lib/permissions";
import { invitationIssuerRole } from "@/lib/staff/invite-authority";

const retrySeconds = [60, 300, 900, 3600, 21600];
const safeRetryWindowMs = 23 * 60 * 60 * 1000;
export class NotificationRequeueError extends Error {}
type Claim = { id: string; processingToken: string };
type NotificationOutcome = "skipped" | "cancelled" | "failed" | "sent" | "retried";

export class NotificationCursorError extends Error {}
export async function listFailedBusinessNotifications(organisationId: string, cursor?: string) {
  let after: { createdAt: Date; id: string } | undefined;
  if (cursor) {
    try {
      const parsed = z.object({ time: z.string().datetime(), id: z.string().min(1).max(100) }).strict()
        .parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
      after = { createdAt: new Date(parsed.time), id: parsed.id };
    } catch { throw new NotificationCursorError("Invalid notification cursor"); }
  }
  const jobs = await prisma.notificationOutbox.findMany({
    where: { organisationId, privacy: "business", status: "failed", ...(after ? { OR: [
      { createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }
    ] } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 26,
    select: { id: true, template: true, attempts: true, lastError: true, createdAt: true }
  });
  const page = jobs.slice(0, 25); const last = page.at(-1);
  return { jobs: page, nextCursor: jobs.length > 25 && last
    ? Buffer.from(JSON.stringify({ time: last.createdAt.toISOString(), id: last.id })).toString("base64url") : null };
}

export async function enqueueNotification(tx: Prisma.TransactionClient, input: {
  eventKey: string; recipient: string; template: NotificationTemplate; payload: unknown;
  userId?: string; organisationId?: string; expiresAt?: Date; templateVersion?: number; authTokenId?: string;
  staffInviteId?: string; staffInviteVersion?: number;
}) {
  const recipient = z.string().trim().toLowerCase().email().max(320).parse(input.recipient);
  const template = notificationTemplateSchema.parse(input.template);
  if (template === "staff_invite" && (!input.staffInviteId || !Number.isInteger(input.staffInviteVersion) || (input.staffInviteVersion ?? 0) < 1))
    throw new Error("Staff invitations require versioned linkage");
  const privacy = template === "business_notice" ? "business" : "security";
  if (privacy === "business" && !input.organisationId) throw new Error("Business notifications require a tenant");
  if (privacy === "security" && input.organisationId) throw new Error("Security notifications cannot belong to a tenant");
  const eventKey = z.string().min(1).max(200).parse(input.eventKey);
  const templateVersion = z.number().int().min(1).max(1000).parse(input.templateVersion ?? 1);
  const id = `notification_${randomUUID()}`;
  // Render once. Retries must not change sender, templates, links or message text.
  const rendered = renderedNotificationSchema.parse({ ...renderNotification(template, input.payload), from: process.env.EMAIL_FROM });
  const encryptedPayload = encryptNotification(rendered, id);
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "NotificationOutbox" ("id", "eventKey", "recipient", "template", "templateVersion", "privacy", "userId", "organisationId", "encryptedPayload", "expiresAt", "authTokenId", "staffInviteId", "staffInviteVersion", "updatedAt")
    VALUES (${id}, ${eventKey}, ${recipient}, ${template}, ${templateVersion}, ${privacy}, ${input.userId ?? null}, ${input.organisationId ?? null}, ${encryptedPayload}, ${input.expiresAt ?? null}, ${input.authTokenId ?? null}, ${input.staffInviteId ?? null}, ${input.staffInviteVersion ?? null}, NOW())
    ON CONFLICT ("eventKey", "recipient", "templateVersion") DO NOTHING RETURNING "id"
  `;
  return { enqueued: rows.length === 1, id: rows[0]?.id ?? null };
}

export async function claimNotificationJobs(now = new Date(), limit = 25): Promise<Claim[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid notification batch size");
  const stale = new Date(now.getTime() - 600000);
  return prisma.$queryRaw<Claim[]>`
    UPDATE "NotificationOutbox" SET "status" = 'processing', "processingStartedAt" = ${now},
      "processingToken" = gen_random_uuid()::text, "updatedAt" = ${now}
    WHERE "id" IN (SELECT "id" FROM "NotificationOutbox"
      WHERE ("status" = 'pending' AND "nextAttemptAt" <= ${now})
         OR ("status" = 'processing' AND "processingStartedAt" < ${stale})
      ORDER BY "nextAttemptAt", "createdAt", "id" FOR UPDATE SKIP LOCKED LIMIT ${limit})
    RETURNING "id", "processingToken"
  `;
}

export async function processNotificationClaim(claim: Claim, now = new Date()): Promise<NotificationOutcome> {
  const fence = { id: claim.id, status: "processing", processingToken: claim.processingToken };
  const job = await prisma.notificationOutbox.findFirst({ where: fence });
  if (!job) return "skipped";
  if (job.template === "staff_invite" || job.staffInviteId || job.eventKey.startsWith("staff-invite/")) {
    const invite = job.staffInviteId ? await prisma.organisationStaffInvite.findUnique({ where: { id: job.staffInviteId } }) : null;
    const issuer = invite ? await invitationIssuerRole(prisma, invite.organisationId, invite.invitedById) : null;
    if (!invite || invite.version !== job.staffInviteVersion || invite.email !== job.recipient ||
        invite.acceptedAt || invite.revokedAt || invite.expiresAt <= now || job.template !== "staff_invite" ||
        job.privacy !== "security" || job.organisationId || !issuer || (invite.role === "owner" && issuer !== "owner")) {
      await prisma.notificationOutbox.updateMany({ where: fence, data: { status: "cancelled", lastError: "obsolete_invite", processingToken: null } });
      return "cancelled";
    }
  }
  if (job.eventKey.startsWith("auth/") && !job.authTokenId) {
    await prisma.notificationOutbox.updateMany({ where: fence, data: { status: "cancelled", lastError: "obsolete_token", processingToken: null } });
    return "cancelled";
  }
  if (job.authTokenId) {
    const token = await prisma.authToken.findUnique({ where: { id: job.authTokenId }, include: { user: { select: { disabledAt: true, authVersion: true, email: true, emailVerifiedAt: true } } } });
    const recipient = token?.purpose === "email_change" ? token.newEmail : token?.email;
    const template = token?.purpose === "email_change" ? "email_change_requested" : token?.purpose;
    if (!token || token.consumedAt || token.invalidatedAt || token.expiresAt <= now || token.user.disabledAt ||
        token.authVersion !== token.user.authVersion || token.email !== token.user.email ||
        !recipient || job.recipient !== recipient || job.userId !== token.userId || job.template !== template ||
        !["verify_account", "reset_password", "email_change"].includes(token.purpose) ||
        (token.purpose === "verify_account" && token.user.emailVerifiedAt)) {
      await prisma.notificationOutbox.updateMany({ where: fence, data: { status: "cancelled", lastError: "obsolete_token", processingToken: null } });
      return "cancelled";
    }
  }
  if (job.expiresAt && job.expiresAt <= now) {
    await prisma.notificationOutbox.updateMany({ where: fence, data: { status: "cancelled", lastError: "expired", processingToken: null } });
    return "cancelled";
  }
  if (job.attempts >= 5 || (job.firstAttemptAt && now.getTime() - job.firstAttemptAt.getTime() >= safeRetryWindowMs)) {
    await prisma.notificationOutbox.updateMany({ where: fence, data: { status: "failed", lastError: "provider_review_required", processingToken: null } });
    return "failed";
  }
  let email: z.infer<typeof renderedNotificationSchema>;
  try { email = renderedNotificationSchema.parse(decryptNotification(job.encryptedPayload, job.id)); }
  catch {
    await prisma.notificationOutbox.updateMany({ where: fence, data: { status: "failed", lastError: "invalid_payload", processingToken: null } });
    return "failed";
  }
  const started = await prisma.notificationOutbox.updateMany({ where: fence, data: {
    attempts: { increment: 1 }, firstAttemptAt: job.firstAttemptAt ?? now
  } });
  if (started.count !== 1) return "skipped";
  let delivery;
  try {
    delivery = await sendWithResend({ to: job.recipient, ...email, idempotencyKey: `notification/${job.id}`, notification: true });
  } catch {
    const exhausted = job.attempts + 1 >= 5;
    const updated = await prisma.notificationOutbox.updateMany({ where: fence, data: {
      status: exhausted ? "failed" : "pending", lastError: "provider_unavailable",
      nextAttemptAt: new Date(now.getTime() + retrySeconds[Math.min(job.attempts, 4)] * 1000),
      processingToken: null, processingStartedAt: null
    } });
    if (exhausted && updated.count) emitOperationalAlert("notification_outbox_retry_exhausted", { jobId: job.id });
    return updated.count ? (exhausted ? "failed" : "retried") : "skipped";
  }
  // A failed local finalization leaves a reclaimable lease; retry the immutable
  // provider request. Never treat it as evidence that the provider did not send.
  const updated = await prisma.notificationOutbox.updateMany({ where: fence, data: {
    status: "sent", providerMessageId: delivery.providerMessageId, acceptedAt: now,
    processingToken: null, processingStartedAt: null, lastError: null
  } });
  return updated.count ? "sent" : "skipped";
}

export async function processNotificationBatch() {
  const result = { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0, cancelled: 0 };
  const claims = await claimNotificationJobs();
  result.claimed = claims.length;
  for (const claim of claims) {
    try { result[await processNotificationClaim(claim)]++; }
    catch { result.skipped++; }
  }
  logInfo("notification_outbox.batch.processed", result);
  return result;
}

export async function requeueBusinessNotification(input: { jobId: string; organisationId: string; actorUserId: string; reason: string }, now = new Date()) {
  if (input.reason.trim().length < 8 || input.reason.length > 500) throw new NotificationRequeueError("A review reason between 8 and 500 characters is required");
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${input.organisationId} FOR UPDATE`;
    const staff = await tx.organisationStaff.findUnique({ where: { organisationId_userId: { organisationId: input.organisationId, userId: input.actorUserId } } });
    const legacyMode = process.env.LEGACY_ORGANISATION_ACCESS_MODE ?? (process.env.NODE_ENV === "production" ? "deny" : "allow");
    const owner = !staff && legacyMode === "allow" && await tx.organisation.findFirst({ where: { id: input.organisationId, accountUserId: input.actorUserId } });
    if (!(staff?.status === "active" && hasOrganisationPermission(staff.role, "orders:email_resend")) && !owner) throw new NotificationRequeueError("Notification is unavailable");
    const job = await tx.notificationOutbox.findFirst({ where: { id: input.jobId, organisationId: input.organisationId, privacy: "business" } });
    if (!job || job.status !== "failed" || job.acceptedAt || (job.expiresAt && job.expiresAt <= now) ||
        (job.firstAttemptAt && now.getTime() - job.firstAttemptAt.getTime() >= safeRetryWindowMs)) throw new NotificationRequeueError("Job is not eligible; provider review or a new business intent is required");
    const updated = await tx.notificationOutbox.updateMany({ where: { id: job.id, status: "failed" }, data: {
      status: "pending", attempts: 0, nextAttemptAt: now, lastError: null, processingToken: null, processingStartedAt: null
    } });
    if (updated.count !== 1) throw new NotificationRequeueError("Job changed during review");
    await tx.auditLog.create({ data: { organisationId: input.organisationId, actorUserId: input.actorUserId,
      action: "notification.requeued", targetType: "NotificationOutbox", targetId: job.id, metadata: { reason: input.reason.trim() } } });
  });
}
