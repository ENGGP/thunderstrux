import { Prisma } from "@prisma/client";
import { expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
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
  await joinOrganisation(member.id, organisation.id);
  const event = await createEvent({ organisationId: organisation.id });
  const ticketTypeId = event.ticketTypes[0].id;
  const references = { organisationId: organisation.id, eventId: event.id, ticketTypeId, userId: member.id };
  const paid = await createOrder({ ...references, status: "paid", paidAt: new Date() });
  await prisma.ticket.create({ data: { orderId: paid.id, eventId: event.id, ticketTypeId, organisationId: organisation.id } });
  await createReservation({ ...references, orderId: paid.id, status: "confirmed", confirmedAt: new Date(), expiresAt: new Date(Date.now() + 60000) });
  await prisma.emailOutbox.create({ data: { orderId: paid.id, mode: "automatic" } });
  await prisma.orderLifecycleEvent.create({ data: { orderId: paid.id, sequence: 1, type: "legacy_baseline", source: "legacy" } });
  const failed = await createOrder({ ...references, status: "failed", failedAt: new Date(), failureReason: "synthetic_unfulfillable", requiresCompensationReview: true });
  const job = await prisma.compensationRefundJob.create({ data: { orderId: failed.id, amount: failed.totalAmount } });
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
