import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { cleanUpExpiredTokens, tokenRetentionMs } from "@/lib/security/token-cleanup";
import { createTicketTypeSchema, updateTicketTypeSchema } from "@/lib/validators/events";
import { createMember, unique } from "@/tests/helpers/test-data";

describe("security limits (T39)", () => {
  test("ticket prices and stock stay inside what Stripe charges and a 32-bit total holds", () => {
    const ticket = { name: "General", price: 99_999_999, quantity: 1_000_000 };
    expect(createTicketTypeSchema.safeParse(ticket).success).toBe(true);
    for (const over of [{ price: 100_000_000 }, { quantity: 1_000_001 }, { memberPrice: 100_000_000 }, { price: 2 ** 31 }]) {
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
});
