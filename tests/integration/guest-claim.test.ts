import { describe, expect, test, vi } from "vitest";
import { POST as claimRoute } from "@/app/api/guest/orders/[orderId]/claim/route";
import GuestOrderPage from "@/app/guest/orders/[orderId]/page";
import { signupAccount } from "@/lib/auth/account-lifecycle";
import { prisma } from "@/lib/db";
import { decryptNotification } from "@/lib/email/notification-crypto";
import { guestCookieName, readGuestSession, redeemGuestAccess, requestGuestAccess } from "@/lib/guest/guest-access";
import { claimGuestOrder, GuestClaimError } from "@/lib/guest/guest-claim";
import { createEventCheckout } from "@/lib/payments/checkout-creation";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { renderPage } from "@/tests/helpers/render";
import { createEvent, createMember, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() })
}));

// A guest who bought free tickets, holding the checkout session that bought them.
async function guestPurchase(email = `${unique("buyer")}@example.com`) {
  const { organisation } = await createOrganisationAccount();
  const event = await createEvent({ organisationId: organisation.id, status: "published", ticketTypes: [{ name: "Free entry", price: 0, quantity: 20 }] });
  await requestGuestAccess(email);
  const job = await prisma.notificationOutbox.findFirstOrThrow({ where: { recipient: email, status: "pending" }, orderBy: { createdAt: "desc" } });
  const { text } = decryptNotification(job.encryptedPayload, job.id) as { text: string };
  const { sessionId } = await redeemGuestAccess(new URLSearchParams(new URL(text.split("\n\n").at(-1)!).hash.slice(1)).get("token")!);
  const session = (await readGuestSession(sessionId))!;
  const { orderId } = await createEventCheckout({
    eventId: event.id, ticketTypeId: event.ticketTypes[0].id, quantity: 2, expectedUnitPrice: 0, idempotencyKey: unique("claim-key"),
    guest: { grantId: session.grantId, guestIdentityId: session.guestIdentityId }
  }) as { orderId: string };
  return { email, sessionId, orderId, organisation };
}

const claimRequest = (orderId: string, sessionId?: string) =>
  claimRoute(jsonRequest(`http://localhost:3000/api/guest/orders/${orderId}/claim`, {}, { headers: sessionId ? { cookie: `${guestCookieName}=${sessionId}` } : {} }), routeContext({ orderId }));

describe("adding a guest order to an account", () => {
  test("a verified member with the same email adds it once, keeping the buyer capture, with one audit entry", async () => {
    const purchase = await guestPurchase();
    const before = await prisma.order.findUniqueOrThrow({ where: { id: purchase.orderId } });
    const member = await createMember({ email: purchase.email });

    const results = await Promise.all([
      claimGuestOrder({ userId: member.id, guestSessionId: purchase.sessionId, orderId: purchase.orderId }),
      claimGuestOrder({ userId: member.id, guestSessionId: purchase.sessionId, orderId: purchase.orderId })
    ]);
    expect(results.map((result) => result.claimed).sort()).toEqual([false, true]);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: purchase.orderId } })).toMatchObject({
      userId: member.id, guestIdentityId: before.guestIdentityId, buyerEmailSnapshot: before.buyerEmailSnapshot,
      buyerIdentityProvenance: "verified_guest", buyerIdentityCapturedAt: before.buyerIdentityCapturedAt
    });
    expect(await prisma.auditLog.count({ where: { action: "order.guest_claimed", targetId: purchase.orderId, actorUserId: member.id } })).toBe(1);
  });

  test("another email, a changed email, an unverified account or a missing guest session cannot add it", async () => {
    const purchase = await guestPurchase();
    const colleague = await createMember();
    await expect(claimGuestOrder({ userId: colleague.id, guestSessionId: purchase.sessionId, orderId: purchase.orderId })).rejects.toMatchObject({ kind: "email_mismatch" });

    // The member had the guest's email, then changed it before claiming.
    const member = await createMember({ email: purchase.email });
    await prisma.user.update({ where: { id: member.id }, data: { email: `changed-${purchase.email}` } });
    await expect(claimGuestOrder({ userId: member.id, guestSessionId: purchase.sessionId, orderId: purchase.orderId })).rejects.toMatchObject({ kind: "email_mismatch" });
    await prisma.user.update({ where: { id: member.id }, data: { email: purchase.email, emailVerifiedAt: null } });
    await expect(claimGuestOrder({ userId: member.id, guestSessionId: purchase.sessionId, orderId: purchase.orderId })).rejects.toThrow("Verify your email");
    await prisma.user.update({ where: { id: member.id }, data: { emailVerifiedAt: new Date() } });

    for (const sessionId of [undefined, "E".repeat(43)]) {
      await expect(claimGuestOrder({ userId: member.id, guestSessionId: sessionId, orderId: purchase.orderId })).rejects.toBeInstanceOf(GuestClaimError);
    }
    // A guest session for another of the same address's orders does not reach this one.
    const other = await guestPurchase(purchase.email);
    await expect(claimGuestOrder({ userId: member.id, guestSessionId: other.sessionId, orderId: purchase.orderId })).rejects.toMatchObject({ kind: "unavailable" });

    expect((await prisma.order.findUniqueOrThrow({ where: { id: purchase.orderId } })).userId).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "order.guest_claimed" } })).toBe(0);
  });

  test("signing up with the guest's email never claims anything", async () => {
    const purchase = await guestPurchase();
    await signupAccount({ email: purchase.email, password: "password123", accountRole: "member" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: purchase.orderId } })).userId).toBeNull();
  });

  test("the route needs a login and answers conflicts, and the page shows each state", async () => {
    const purchase = await guestPurchase();
    expect((await claimRequest(purchase.orderId, purchase.sessionId)).status).toBe(401);

    const page = async () => renderPage(await GuestOrderPage({ params: Promise.resolve({ orderId: purchase.orderId }) }));
    globalThis.__THUNDERSTRUX_TEST_GUEST__ = purchase.sessionId;
    expect(await page()).toContain("Keep your tickets in one place");

    const colleague = await createMember();
    setMockSession({ userId: colleague.id, email: colleague.email, accountRole: "member" });
    expect(await page()).toContain("This order uses a different email");
    const conflict = await claimRequest(purchase.orderId, purchase.sessionId);
    expect(conflict.status).toBe(409);
    expect((await parseJsonResponse(conflict)).error.details[0].reason).toBe("email_mismatch");

    const member = await createMember({ email: purchase.email });
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    expect(await page()).toContain("Add to my account");
    expect(await parseJsonResponse(await claimRequest(purchase.orderId, purchase.sessionId))).toEqual({ claimed: true });
    expect(await page()).toContain("This order is in your account");
  });
});
