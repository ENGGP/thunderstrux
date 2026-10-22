import { createJiti } from "jiti";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
// The audit library imports through the "@/" path alias.
const jiti = createJiti(import.meta.url, { alias: { "@/": `${process.cwd().replace(/\\/g, "/")}/` } });
const { decryptNotification } = await jiti.import("../lib/email/notification-crypto.ts");
const { runDatabaseIntegrityAudit } = await jiti.import("../lib/ops/integrity-audit.ts");

try {
  const [users, organisations, staff, orders, tickets, reservations, outbox, lifecycleEvents, auditLogs, refundJobs, refundWebhookEvents, notifications, authTokens, securityEvents, migrations] = await Promise.all([
    prisma.user.count(),
    prisma.organisation.count(),
    prisma.organisationStaff.count(),
    prisma.order.count(),
    prisma.ticket.count(),
    prisma.ticketReservation.count(),
    prisma.emailOutbox.count(),
    prisma.orderLifecycleEvent.count({
      where: { sequence: 1, type: "order_created", source: "checkout" }
    }),
    prisma.auditLog.count(),
    prisma.compensationRefundJob.count(),
    prisma.stripeRefundWebhookEvent.count(),
    prisma.notificationOutbox.count(),
    prisma.authToken.count(),
    prisma.accountSecurityEvent.count(),
    prisma.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL`)
  ]);
  const inviteJob = await prisma.notificationOutbox.findUnique({ where: { id: "ops-invite-notification" }, include: { staffInvite: true } });
  if (!inviteJob || inviteJob.privacy !== "security" || inviteJob.organisationId || inviteJob.staffInviteVersion !== 2 || inviteJob.staffInvite?.version !== 2 || inviteJob.staffInvite.email !== inviteJob.recipient) throw new Error("Restored invitation version/private linkage is missing");
  const rendered = decryptNotification(inviteJob.encryptedPayload, inviteJob.id);
  if (rendered.text !== `http://localhost/staff/invites/accept#token=${Buffer.alloc(32, 5).toString("base64url")}`) throw new Error("Restored invitation payload cannot be decrypted with the recovered notification key");
  const handover = await prisma.organisation.findUnique({ where: { slug: "ops-handover-restore" }, include: { staff: { include: { user: true } }, auditLogs: true } });
  if (!handover || handover.accountUserId !== null || handover.staff.filter(row => row.role === "owner" && row.status === "active").length !== 1 ||
      !handover.staff.some(row => row.status === "revoked" && row.user.email === "ops-outgoing-owner@example.com") ||
      !handover.auditLogs.some(row => row.action === "staff.ownership.handed_over" && row.metadata?.legacyOwnershipRetired === true)) throw new Error("Restored ownership retirement/staff/audit continuity is missing");
  const migrationCount = Number(migrations[0]?.count ?? 0);
  const emailChange = await prisma.authToken.findFirst({ where: { purpose: "email_change", newEmail: "ops-change@example.com" } });
  if (!emailChange) throw new Error("Restored email-change binding is missing");
  const closedBuyer = await prisma.order.findFirst({ where: { buyerEmailSnapshot: "ops-retained@example.com", buyerIdentityProvenance: "current_account_at_capture" }, include: { user: true } });
  const snapshotOrder = await prisma.order.findFirst({ where: { purchasedTicketTypeName: "ops purchased ticket name" } });
  if (snapshotOrder?.sellerName !== "ops seller at purchase" || snapshotOrder.paymentKind !== "stripe" || snapshotOrder.feePolicyVersion !== "platform_fee_10_percent_v1" || snapshotOrder.snapshotVersion !== 1) throw new Error("Restored purchase snapshot is missing");
  const attempt = await prisma.checkoutAttempt.findUnique({ where: { providerOperationKey: "ops-restore-provider-key" }, include: { order: true } });
  if (attempt?.state !== "provider_uncertain" || attempt.clientIdempotencyKey !== "ops-restore-attempt" || attempt.order?.purchasedTicketTypeName !== "ops purchased ticket name" || attempt.providerRequest?.metadata?.restoreCheck !== "ops") throw new Error("Restored checkout attempt is missing");
  if (!(await prisma.event.findFirst({ where: { capacity: 217, visibility: "unlisted", saleState: "closed", version: { gte: 2 }, salesCloseAt: { not: undefined } } }))) throw new Error("Restored event policy is missing");
  if (!(await prisma.ticket.findFirst({ where: { issueSequence: { gte: 1 }, validity: "active" } }))) throw new Error("Restored tickets lost their issue sequence or validity");
  if (!closedBuyer?.buyerIdentityCapturedAt || !closedBuyer.user?.closedAt || !closedBuyer.user?.disabledAt || closedBuyer.user.authVersion !== 1 || closedBuyer.buyerFirstNameSnapshot !== "Retained") throw new Error("Restored closure/retained buyer identity is missing");


  if (migrationCount < 1 || users < 1 || organisations < 1 || staff < 1 || orders < 1 ||
      tickets < 1 || reservations < 1 || outbox < 1 || lifecycleEvents < 1 || auditLogs < 1 || notifications < 1 || authTokens < 1 || securityEvents < 1) {
    throw new Error(`Restored database is missing required verification records: ${JSON.stringify({
      migrationCount, users, organisations, staff, orders, tickets, reservations, outbox, lifecycleEvents, auditLogs, refundJobs, refundWebhookEvents
    })}`);
  }

  // T41: the restored copy passes the integrity audit, apart from explained legacy rows.
  const audit = await runDatabaseIntegrityAudit();
  const unexplained = audit.filter((result) => !result.legacy && result.count > 0).map((result) => `${result.name}=${result.count}`);
  if (unexplained.length) throw new Error(`Restored database fails the integrity audit: ${unexplained.join(", ")}`);

  console.log(JSON.stringify({
    status: "verified",
    integrityChecks: audit.length,
    invitationVersionAndDecryption: true,
    ownershipHandoverContinuity: true,
    users,
    organisations,
    staff,
    orders,
    tickets,
    reservations,
    outbox,
    lifecycleEvents,
    auditLogs,
    refundJobs,
    refundWebhookEvents,
    notifications,
    authTokens,
    securityEvents,
    migrations: migrationCount
  }));
} finally {
  await prisma.$disconnect();
}
