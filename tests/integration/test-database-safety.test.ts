import { Prisma } from "@prisma/client";
import { expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { assertTestDatabaseUrl, resetTestDatabase } from "@/tests/helpers/db-reset";
import {
  createEvent, createMember, createOrder, createOrganisationAccount,
  createReservation, joinOrganisation, unique
} from "@/tests/helpers/test-data";

test("reset refuses unsafe configuration before SQL and does not expose credentials", async () => {
  const execute = vi.spyOn(prisma, "$executeRawUnsafe");
  for (const value of [
    "postgresql://test:private-password@db/production",
    "postgresql://test:private-password@db/project_test_archive",
    "postgresql://test:private-password@db/folder%2Fproject_test",
    "malformed-private-password"
  ]) {
    vi.stubEnv("DATABASE_URL", value);
    expect(assertTestDatabaseUrl).toThrow(/Refusing integration database access/);
    await expect(resetTestDatabase()).rejects.toThrow(/Refusing integration database access/);
    try { assertTestDatabaseUrl(); } catch (error) {
      expect((error as Error).message).not.toContain("private-password");
    }
  }
  expect(execute).not.toHaveBeenCalled();
});

test("reset clears every current model including dependent and unlinked recovery records", async () => {
  const { user: owner, organisation } = await createOrganisationAccount();
  const member = await createMember();
  const photo = await prisma.asset.create({ data: { organisationId: organisation.id, uploadedByUserId: owner.id, storageKey: unique("assets/reset"), kind: "product", byteSize: 10, width: 1, height: 1, sha256: "0".repeat(64) } });
  const product = await prisma.merchandiseProduct.create({ data: { organisationId: organisation.id, name: "Synthetic tote" } });
  await prisma.merchandiseProductImage.create({ data: { productId: product.id, organisationId: organisation.id, assetId: photo.id, position: 0 } });
  await prisma.merchandiseVariant.create({ data: { productId: product.id, organisationId: organisation.id, sku: "RESET-TOTE", priceAmount: 0, remaining: 1 } });
  await joinOrganisation(member.id, organisation.id);
  const event = await createEvent({ organisationId: organisation.id });
  const ticketTypeId = event.ticketTypes[0].id;
  const references = { organisationId: organisation.id, eventId: event.id, ticketTypeId, userId: member.id };
  const paid = await createOrder({ ...references, status: "paid", paidAt: new Date() });
  await prisma.ticket.create({ data: { issueSequence: 1, orderId: paid.id, eventId: event.id, ticketTypeId, organisationId: organisation.id } });
  await createReservation({ ...references, orderId: paid.id, status: "confirmed", confirmedAt: new Date(), expiresAt: new Date(Date.now() + 60000) });
  await prisma.emailOutbox.create({ data: { orderId: paid.id, mode: "automatic" } });
  await prisma.orderLifecycleEvent.create({ data: { orderId: paid.id, sequence: 1, type: "legacy_baseline", source: "legacy" } });
  await prisma.refundRequest.create({ data: { orderId: paid.id, organisationId: organisation.id, amount: paid.totalAmount, reason: "Synthetic reset fixture", operationKey: unique("reset-refund") } });
  const tote = await prisma.$transaction((tx) => createCommerceOrder(tx, { organisationId: organisation.id, kind: "merchandise", buyer: { userId: member.id }, buyerEmail: member.email, paymentKind: "free", lines: [{ quantity: 1, unitAmount: 0, name: "Synthetic tote" }], source: "checkout" }));
  const toteLine = await prisma.commerceOrderLine.findFirstOrThrow({ where: { orderId: tote.id } });
  await prisma.eventChange.create({ data: { eventId: event.id, organisationId: organisation.id, eventVersion: 2 + (await prisma.eventChange.count()), previousStartTime: event.startTime, previousEndTime: event.endTime, previousLocation: event.location, startTime: event.startTime, endTime: event.endTime, location: "Moved" } });
  await prisma.merchandiseReturn.create({ data: { organisationId: organisation.id, commerceOrderId: tote.id, commerceOrderLineId: toteLine.id, quantity: 1, restocked: false, reason: "Synthetic reset fixture", operationKey: unique("reset-return") } });
  const term = { startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 2 * 86_400_000) };
  const plan = await prisma.membershipProduct.create({ data: { organisationId: organisation.id, name: "Synthetic plan", priceAmount: 0, ...term } });
  const membership = await prisma.$transaction((tx) => createCommerceOrder(tx, { organisationId: organisation.id, kind: "membership", buyer: { userId: member.id }, buyerEmail: member.email, paymentKind: "free", lines: [{ quantity: 1, unitAmount: 0, name: plan.name, termStartsAt: term.startsAt, termEndsAt: term.endsAt, membershipProductId: plan.id }], source: "checkout" }));
  const line = await prisma.commerceOrderLine.findFirstOrThrow({ where: { orderId: membership.id } });
  await prisma.membershipGrant.create({ data: { userId: member.id, organisationId: organisation.id, membershipProductId: plan.id, commerceOrderLineId: line.id, ...term, entitlements: [], entitlementVersion: 1 } });
  await prisma.purchaseDispute.create({ data: { orderId: paid.id, organisationId: organisation.id, stripeDisputeId: unique("dp"), stripeChargeId: unique("ch"), amount: paid.totalAmount, currency: "aud", providerStatus: "needs_response" } });
  const failed = await createOrder({ ...references, status: "failed", failedAt: new Date(), failureReason: "synthetic_unfulfillable", requiresCompensationReview: true });
  const job = await prisma.compensationRefundJob.create({ data: { orderId: failed.id, amount: failed.totalAmount } });
  await prisma.checkoutAttempt.create({ data: { family: "ticket", actorKind: "user", actorId: member.id, operationType: "event_checkout", clientIdempotencyKey: unique("reset-key"), requestHash: "synthetic", orderId: failed.id, providerOperationKey: unique("reset-provider-key"), state: "failed" } });
  await prisma.stripeRefundWebhookEvent.createMany({ data: [
    { stripeEventId: unique("evt_test"), refundJobId: job.id, eventType: "refund.updated", eventCreatedAt: new Date() },
    { stripeEventId: unique("evt_test_unlinked"), refundJobId: null, eventType: "refund.updated", eventCreatedAt: new Date() }
  ] });
  await prisma.organisationStaffInvite.create({ data: { organisationId: organisation.id, email: "synthetic-invite@example.com", role: "event_manager", tokenHash: unique("synthetic-hash"), invitedById: owner.id, expiresAt: new Date(Date.now() + 60000) } });
  await prisma.auditLog.create({ data: { organisationId: organisation.id, actorUserId: owner.id, action: "synthetic.reset_verification", targetType: "Event", targetId: event.id } });
  await prisma.userMfa.create({ data: { userId: member.id, pendingEncryptedSecret: "synthetic-placeholder" } });
  await prisma.mfaRecoveryCode.create({ data: { userId: member.id, codeHash: unique("synthetic-recovery") } });
  await prisma.mfaGrant.create({ data: { userId: member.id, sessionDigest: unique("synthetic-session"), verifiedAt: new Date(), expiresAt: new Date(Date.now() + 60000) } });

  await prisma.notificationOutbox.create({ data: { eventKey: "reset-fixture", recipient: "synthetic@example.com", template: "password_changed", privacy: "security", encryptedPayload: "synthetic", userId: member.id } });

  await prisma.authToken.create({ data: { userId: member.id, tokenHash: unique("synthetic-auth-token"), purpose: "verify_account", email: member.email, authVersion: 0, expiresAt: new Date(Date.now() + 60000) } });
  await prisma.accountSecurityEvent.create({ data: { userId: member.id, type: "password_changed", authVersion: 0 } });
  const guest = await prisma.guestIdentity.create({ data: { email: "synthetic-guest@example.com" } });
  await prisma.guestAccessGrant.create({ data: { guestIdentityId: guest.id, purpose: "checkout", tokenDigest: unique("synthetic-guest-token"), expiresAt: new Date(Date.now() + 60000) } });

  // Derived from the schema so adding a model requires an intentional fixture
  // update; table names never come from request or environment input.
  const delegates = prisma as unknown as Record<string, { count(): Promise<number> }>;
  const counts = async () => Object.fromEntries(await Promise.all(Prisma.dmmf.datamodel.models.map(async model => {
    const delegate = delegates[model.name[0].toLowerCase() + model.name.slice(1)];
    return [model.name, await delegate.count()];
  })));
  for (const [model, count] of Object.entries(await counts())) expect(count, `${model} fixture`).toBeGreaterThan(0);
  await resetTestDatabase();
  for (const [model, count] of Object.entries(await counts())) expect(count, `${model} after reset`).toBe(0);
  await resetTestDatabase();
  for (const count of Object.values(await counts())) expect(count).toBe(0);
});
