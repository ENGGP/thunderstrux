import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { cleanUpExpiredTokens, tokenRetentionMs } from "@/lib/security/token-cleanup";
import { createTicketTypeSchema, updateTicketTypeSchema } from "@/lib/validators/events";
import { createMember, unique } from "@/tests/helpers/test-data";

describe("security limits (T39)", () => {
  test("ticket prices and stock stay inside what Stripe charges and a 32-bit total holds", () => {
    const ticket = { name: "General", price: 99_999_999, quantity: 1_000_000 };
    expect(createTicketTypeSchema.safeParse(ticket).success).toBe(true);
    for (const free of [{ price: 0 }, { memberPrice: 0 }, { price: 200, memberPrice: 200 }]) expect(createTicketTypeSchema.safeParse({ ...ticket, ...free }).success).toBe(true);
    // Paid prices start at $2.00, so the society keeps more than half after the fee; below 93c it kept nothing.
    for (const over of [{ price: 100_000_000 }, { quantity: 1_000_001 }, { memberPrice: 100_000_000 }, { price: 2 ** 31 }, { price: 199 }, { price: 50 }, { price: 1 }, { memberPrice: 199 }]) {
      expect(createTicketTypeSchema.safeParse({ ...ticket, ...over }).success).toBe(false);
      expect(updateTicketTypeSchema.safeParse({ ...ticket, ...over }).success).toBe(false);
    }
  });

  test("tokens and MFA grants are deleted a while after they stop working, in bounded batches, and references are cleared", async () => {
    const user = await createMember();
    const now = new Date();
    const long = new Date(now.getTime() - tokenRetentionMs - 60_000);
    const recent = new Date(now.getTime() - 60_000);
    const token = (expiresAt: Date) =>
      prisma.authToken.create({ data: { tokenHash: unique("hash"), purpose: "reset_password", userId: user.id, email: user.email, authVersion: 0, expiresAt } });
    const old = await Promise.all([token(long), token(long), token(long)]);
    const kept = await token(recent);
    const outbox = await prisma.notificationOutbox.create({
      data: { eventKey: unique("reset"), recipient: user.email, template: "password_reset", privacy: "security", encryptedPayload: "x", userId: user.id, authTokenId: old[0].id }
    });
    await prisma.mfaGrant.createMany({ data: [
      { sessionDigest: unique("old"), userId: user.id, verifiedAt: long, expiresAt: long },
      { sessionDigest: unique("live"), userId: user.id, verifiedAt: now, expiresAt: new Date(now.getTime() + 3600_000) }
    ] });

    expect(await cleanUpExpiredTokens(now, 2)).toMatchObject({ authTokens: 2, mfaGrants: 1 });
    expect(await cleanUpExpiredTokens(now, 2)).toMatchObject({ authTokens: 1, mfaGrants: 0 });
    expect(await cleanUpExpiredTokens(now, 2)).toMatchObject({ authTokens: 0 });
    expect(await prisma.authToken.findMany({ where: { userId: user.id }, select: { id: true } })).toEqual([{ id: kept.id }]);
    expect(await prisma.mfaGrant.count({ where: { userId: user.id } })).toBe(1);
    expect((await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: outbox.id } })).authTokenId).toBeNull();
  });

  test("a finished notification, with its plain-text recipient, goes 30 days after it finished, in bounded batches; unfinished ones stay (SEC-043)", async () => {
    const now = new Date();
    const long = new Date(now.getTime() - tokenRetentionMs - 60_000);
    const recent = new Date(now.getTime() - 60_000);
    const notice = (status: string, updatedAt: Date, eventKey = unique("notice")) =>
      prisma.notificationOutbox.create({ data: { eventKey, recipient: "closed@example.com", template: "business_notice", privacy: "security", encryptedPayload: "x", status, updatedAt } });
    const kept = await Promise.all([notice("sent", recent), notice("failed", recent), notice("cancelled", recent), notice("pending", long), notice("processing", long)]);
    await Promise.all(["sent", "cancelled", "failed"].map((status) => notice(status, long)));

    expect(await cleanUpExpiredTokens(now, 2)).toMatchObject({ notifications: 2 });
    expect(await cleanUpExpiredTokens(now, 2)).toMatchObject({ notifications: 1 });
    expect(await cleanUpExpiredTokens(now, 2)).toMatchObject({ notifications: 0 });
    expect((await prisma.notificationOutbox.findMany({ select: { id: true } })).map((row) => row.id).sort()).toEqual(kept.map((row) => row.id).sort());
  });

  test("a Stripe deadline notice stays until 30 days after the deadline, because its row is all that stops it being announced again (SEC-043)", async () => {
    const now = new Date();
    const long = new Date(now.getTime() - tokenRetentionMs - 60_000);
    const key = (deadline: Date) => `stripe-deadline/org_synthetic/${deadline.toISOString()}`;
    const notice = (eventKey: string) =>
      prisma.notificationOutbox.create({ data: { eventKey, recipient: "manager@example.com", template: "business_notice", privacy: "security", encryptedPayload: "x", status: "sent", updatedAt: long } });
    const standing = await notice(key(new Date(now.getTime() + 60 * 86_400_000)));
    const justPassed = await notice(key(new Date(now.getTime() - 86_400_000)));
    await notice(key(new Date(now.getTime() - tokenRetentionMs - 86_400_000)));

    expect(await cleanUpExpiredTokens(now)).toMatchObject({ notifications: 1 });
    expect((await prisma.notificationOutbox.findMany({ select: { id: true } })).map((row) => row.id).sort()).toEqual([standing.id, justPassed.id].sort());
  });
});
