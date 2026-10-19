import { createJiti } from "jiti";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const jiti = createJiti(import.meta.url);
const { encryptNotification } = await jiti.import("../lib/email/notification-crypto.ts");

try {
  const organisation = await prisma.organisation.findFirst({ orderBy: { id: "asc" } });
  const actor = await prisma.user.findFirst({ orderBy: { id: "asc" } });
  const ticketType = await prisma.ticketType.findFirst({
    include: { event: true },
    orderBy: { id: "asc" }
  });

  if (!organisation || !actor || !ticketType) {
    throw new Error("Seed data is incomplete for operations verification");
  }

  await prisma.$transaction(async (transaction) => {
    const order = await transaction.order.create({
      data: {
        organisationId: ticketType.event.organisationId,
        eventId: ticketType.eventId,
        ticketTypeId: ticketType.id,
        userId: actor.id,
        status: "pending",
        quantity: 1,
        unitPrice: ticketType.price,
        totalAmount: ticketType.price,
        paymentKind: "stripe",
        purchasedTicketTypeName: "ops purchased ticket name",
        sellerName: "ops seller at purchase",
        feeAmount: 0,
        feePolicyVersion: "platform_fee_10_percent_v1",
        snapshotVersion: 1
      }
    });
    await transaction.checkoutAttempt.create({
      data: {
        family: "ticket",
        actorKind: "user",
        actorId: actor.id,
        operationType: "event_checkout",
        clientIdempotencyKey: "ops-restore-attempt",
        requestHash: "ops-restore-request-hash",
        orderId: order.id,
        providerOperationKey: "ops-restore-provider-key",
        providerRequest: { mode: "payment", metadata: { restoreCheck: "ops" } },
        state: "provider_uncertain",
        reconcileDueAt: new Date("2099-01-01T00:00:00.000Z")
      }
    });
    await transaction.orderLifecycleEvent.create({
      data: {
        orderId: order.id,
        sequence: 1,
        type: "order_created",
        source: "checkout",
        toOrderStatus: "pending",
        facts: { compensationReview: false }
      }
    });
    await transaction.ticketReservation.create({
      data: {
        orderId: order.id,
        organisationId: ticketType.event.organisationId,
        eventId: ticketType.eventId,
        ticketTypeId: ticketType.id,
        userId: actor.id,
        quantity: 1,
        status: "active",
        expiresAt: new Date("2099-01-01T00:00:00.000Z")
      }
    });
    await transaction.emailOutbox.create({
      data: {
        orderId: order.id,
        mode: "automatic",
        status: "pending",
        nextAttemptAt: new Date("2099-01-01T00:00:00.000Z")
      }
    });
    const authToken = await transaction.authToken.create({ data: { userId: actor.id, tokenHash: "ops-synthetic-restore-digest", purpose: "verify_account", email: actor.email, authVersion: actor.authVersion, expiresAt: new Date("2099-01-01T00:00:00.000Z") } });
    await transaction.accountSecurityEvent.create({ data: { userId: actor.id, type: "password_changed", authVersion: actor.authVersion } });
    await transaction.authToken.create({ data: { userId: actor.id, tokenHash: "ops-email-change-restore-digest", purpose: "email_change", email: actor.email, newEmail: "ops-change@example.com", authVersion: actor.authVersion, expiresAt: new Date("2099-01-01T00:00:00.000Z") } });
    await transaction.notificationOutbox.create({ data: { eventKey: "ops-restore", recipient: "synthetic@example.com", template: "verify_account", privacy: "security", encryptedPayload: "restore-check-only", userId: actor.id, authTokenId: authToken.id, nextAttemptAt: new Date("2099-01-01T00:00:00.000Z") } });
    const token = Buffer.alloc(32, 5).toString("base64url");
    const invite = await transaction.organisationStaffInvite.create({ data: { organisationId: organisation.id, invitedById: actor.id, email: "ops-invite@example.com", role: "event_manager", version: 2, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date("2099-01-01T00:00:00.000Z") } });
    const jobId = "ops-invite-notification";
    await transaction.notificationOutbox.create({ data: { id: jobId, eventKey: "ops-invite-restore", recipient: invite.email, template: "staff_invite", privacy: "security", staffInviteId: invite.id, staffInviteVersion: 2,
      encryptedPayload: encryptNotification({ subject: "Staff invitation restore check", text: `http://localhost/staff/invites/accept#token=${token}`, html: "<p>Synthetic restore check</p>", from: "synthetic@example.com" }, jobId), nextAttemptAt: new Date("2099-01-01T00:00:00.000Z") } });
    const outgoingOwner = await transaction.user.create({ data: { email: "ops-outgoing-owner@example.com", password: "synthetic-recovery-only", emailVerifiedAt: new Date() } });
    const incomingOwner = await transaction.user.create({ data: { email: "ops-incoming-owner@example.com", password: "synthetic-recovery-only", emailVerifiedAt: new Date() } });
    const handoverOrg = await transaction.organisation.create({ data: { name: "Synthetic handover restore", slug: "ops-handover-restore", accountUserId: null } });
    await transaction.organisationStaff.create({ data: { organisationId: handoverOrg.id, userId: outgoingOwner.id, role: "owner", status: "revoked", revokedAt: new Date(), revokedById: outgoingOwner.id } });
    const incomingStaff = await transaction.organisationStaff.create({ data: { organisationId: handoverOrg.id, userId: incomingOwner.id, role: "owner", status: "active", acceptedAt: new Date() } });
    await transaction.auditLog.create({ data: { organisationId: handoverOrg.id, actorUserId: outgoingOwner.id, action: "staff.ownership.handed_over", targetType: "OrganisationStaff", targetId: incomingStaff.id, metadata: { retiredAccountUserId: outgoingOwner.id, incomingUserId: incomingOwner.id, outgoingStatus: "revoked", legacyOwnershipRetired: true } } });
    const closed = await transaction.user.create({ data: { email: "ops-closed@closed.invalid", password: "!closed:synthetic", closedAt: new Date(), disabledAt: new Date(), authVersion: 1 } });
    await transaction.order.create({ data: { userId: closed.id, organisationId: ticketType.event.organisationId, eventId: ticketType.eventId, ticketTypeId: ticketType.id, status: "expired", quantity: 1, unitPrice: 0, totalAmount: 0, paymentKind: "stripe",
      buyerEmailSnapshot: "ops-retained@example.com", buyerFirstNameSnapshot: "Retained", buyerLastNameSnapshot: "Buyer", buyerIdentityCapturedAt: new Date(), buyerIdentityProvenance: "current_account_at_capture" } });
    await transaction.accountSecurityEvent.create({ data: { userId: closed.id, type: "account_closed", authVersion: 1 } });
    await transaction.event.update({ where: { id: ticketType.eventId }, data: { capacity: 217, visibility: "unlisted", saleState: "closed", version: { increment: 1 } } });
    await transaction.auditLog.create({
      data: {
        organisationId: organisation.id,
        actorUserId: actor.id,
        action: "ops.restore_verification",
        targetType: "deployment",
        targetId: "ops-rehearsal",
        metadata: { containsSecrets: false }
      }
    });
  });
} finally {
  await prisma.$disconnect();
}
