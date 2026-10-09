import { createJiti } from "jiti";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const jiti = createJiti(import.meta.url);
const { decryptNotification } = await jiti.import("../lib/email/notification-crypto.ts");

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
  const inviteJob = await prisma.notificationOutbox.findUnique({ where: { id: "p217-invite-notification" }, include: { staffInvite: true } });
  if (!inviteJob || inviteJob.privacy !== "security" || inviteJob.organisationId || inviteJob.staffInviteVersion !== 2 || inviteJob.staffInvite?.version !== 2 || inviteJob.staffInvite.email !== inviteJob.recipient) throw new Error("Restored invitation version/private linkage is missing");
  const rendered = decryptNotification(inviteJob.encryptedPayload, inviteJob.id);
  if (rendered.text !== `http://localhost/staff/invites/accept#token=${Buffer.alloc(32, 5).toString("base64url")}`) throw new Error("Restored invitation payload cannot be decrypted with the recovered notification key");
  const migrationCount = Number(migrations[0]?.count ?? 0);
  const emailChange = await prisma.authToken.findFirst({ where: { purpose: "email_change", newEmail: "p217-change@example.com" } });
  if (!emailChange) throw new Error("Restored email-change binding is missing");
  const closedBuyer = await prisma.order.findFirst({ where: { buyerEmailSnapshot: "p217-retained@example.com", buyerIdentityProvenance: "current_account_at_capture" }, include: { user: true } });
  if (!closedBuyer?.buyerIdentityCapturedAt || !closedBuyer.user?.closedAt || !closedBuyer.user?.disabledAt || closedBuyer.user.authVersion !== 1 || closedBuyer.buyerFirstNameSnapshot !== "Retained") throw new Error("Restored closure/retained buyer identity is missing");


  if (migrationCount < 1 || users < 1 || organisations < 1 || staff < 1 || orders < 1 ||
      tickets < 1 || reservations < 1 || outbox < 1 || lifecycleEvents < 1 || auditLogs < 1 || notifications < 1 || authTokens < 1 || securityEvents < 1) {
    throw new Error(`Restored database is missing required verification records: ${JSON.stringify({
      migrationCount, users, organisations, staff, orders, tickets, reservations, outbox, lifecycleEvents, auditLogs, refundJobs, refundWebhookEvents
    })}`);
  }

  console.log(JSON.stringify({
    status: "verified",
    invitationVersionAndDecryption: true,
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
