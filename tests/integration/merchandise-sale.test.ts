import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as cancelCommerce } from "@/app/api/commerce/orders/[orderId]/cancel/route";
import { GET as commerceOrderRoute } from "@/app/api/commerce/orders/[orderId]/route";
import { POST as membershipCheckout } from "@/app/api/payments/checkout/membership/route";
import { POST as merchandiseCheckout } from "@/app/api/payments/checkout/merchandise/route";
import { POST as webhookRoute } from "@/app/api/payments/webhook/route";
import { createCommerceCheckout } from "@/lib/commerce/checkout";
import { expireStaleCommerceOrders } from "@/lib/commerce/reconciliation";
import { prisma } from "@/lib/db";
import { decryptNotification } from "@/lib/email/notification-crypto";
import { processNotificationClaim } from "@/lib/email/notification-outbox";
import { GuestAccessError, guestCookieName, readGuestSession, redeemGuestAccess, requestGuestAccess, requestGuestRecovery } from "@/lib/guest/guest-access";
import { guestCsrfToken } from "@/lib/guest/guest-csrf";
import { updateProduct } from "@/lib/merchandise/catalogue";
import { quoteVersion } from "@/lib/merchandise/sale";
import { quoteBasket, shopProduct } from "@/lib/merchandise/shop";
import { clearMockSession, setMockSession } from "@/tests/helpers/auth";
import { guestSession } from "@/tests/helpers/guest";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { createMember, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

const webhookSecret = "whsec_merchandise_test";
const stripe = vi.hoisted(() => ({ create: vi.fn(), retrieve: vi.fn(), expire: vi.fn() }));
vi.mock("@/lib/stripe", async () => {
  const { default: RealStripe } = await vi.importActual<typeof import("stripe")>("stripe");
  return {
    StripeConfigurationError: class StripeConfigurationError extends Error {},
    getAppUrl: () => "http://localhost:3000",
    isLiveStripeKey: () => false,
    getStripeWebhookSecret: () => "whsec_merchandise_test",
    getStripe: () => ({ checkout: { sessions: { create: stripe.create, retrieve: stripe.retrieve, expire: stripe.expire } }, webhooks: new RealStripe("sk_test_merchandise").webhooks })
  };
});
beforeEach(() => {
  stripe.create.mockImplementation(async () => ({ id: unique("cs_merch"), url: "https://checkout.stripe.test/pay" }));
});
afterEach(() => { for (const mock of Object.values(stripe)) mock.mockReset(); });

type Option = { size?: string; priceAmount: number; remaining: number };

// A published product of a society that can take payments, with its options.
async function shop(options: Option[]) {
  const account = await createOrganisationAccount({ stripeReady: true });
  const { organisation, user } = account;
  await prisma.organisation.update({ where: { id: organisation.id }, data: { pickupPolicy: "EngSoc office, weekdays 10 to 2" } });
  const now = new Date();
  const product = await prisma.merchandiseProduct.create({ data: { organisationId: organisation.id, name: unique("Hoodie"), status: "published", publishedAt: now, firstPublishedAt: now } });
  const photo = await prisma.asset.create({ data: { organisationId: organisation.id, uploadedByUserId: user.id, storageKey: unique("assets/shop"), kind: "product", status: "ready", byteSize: 10, width: 8, height: 10, sha256: "0".repeat(64) } });
  await prisma.merchandiseProductImage.create({ data: { productId: product.id, organisationId: organisation.id, assetId: photo.id, position: 0 } });
  const variants = [];
  for (const [position, option] of options.entries()) {
    variants.push(await prisma.merchandiseVariant.create({
      data: { productId: product.id, organisationId: organisation.id, size: option.size ?? `S${position}`, sku: unique("SKU").toUpperCase(), priceAmount: option.priceAmount, remaining: option.remaining, position }
    }));
  }
  return { ...account, user, product, photo, variants };
}

type Item = { variantId: string; quantity: number; unitPrice: number };
const selectionFor = (items: Item[]) => ({
  items: items.map(({ variantId, quantity }) => ({ variantId, quantity })),
  quoteVersion: quoteVersion(items)
});
const totalOf = (items: Item[]) => items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

async function member() {
  const user = await createMember();
  return { userId: user.id, email: user.email };
}

function buy(organisationId: string, buyer: { userId: string } | { guest: { grantId: string; guestIdentityId: string } }, items: Item[], idempotencyKey = unique("merch-key-000")) {
  return createCommerceCheckout({ family: "merchandise", organisationId, buyer, selection: selectionFor(items), expectedTotal: totalOf(items), idempotencyKey });
}

async function verifiedGuest(email = `${unique("guest")}@example.com`) {
  const identity = await prisma.guestIdentity.upsert({ where: { email }, create: { email, verifiedAt: new Date() }, update: {} });
  const grant = await prisma.guestAccessGrant.create({
    data: { guestIdentityId: identity.id, purpose: "checkout", tokenDigest: unique("digest"), expiresAt: new Date(Date.now() + 60_000), consumedAt: new Date(), sessionDigest: unique("session"), sessionExpiresAt: new Date(Date.now() + 3_600_000) }
  });
  return { grantId: grant.id, guestIdentityId: identity.id };
}

async function deliverPaid(commerceOrderId: string, overrides: Record<string, unknown> = {}, id = unique("evt")) {
  const order = await prisma.commerceOrder.findUniqueOrThrow({ where: { id: commerceOrderId } });
  const session = {
    id: order.stripeSessionId, object: "checkout.session", payment_status: "paid", amount_total: order.totalAmount, currency: "aud",
    payment_intent: { id: unique("pi"), transfer_data: { destination: order.sellerStripeAccountId } },
    metadata: { family: "merchandise", commerceOrderId: order.id, organisationId: order.organisationId }, ...overrides
  };
  const body = JSON.stringify({ id, object: "event", type: "checkout.session.completed", livemode: false, created: Math.floor(Date.now() / 1000), data: { object: session } });
  const signature = new Stripe("sk_test_merchandise").webhooks.generateTestHeaderString({ payload: body, secret: webhookSecret });
  const response = await webhookRoute(new Request("http://localhost:3000/api/payments/webhook", { method: "POST", headers: { "stripe-signature": signature }, body }));
  expect(response.status).toBe(200);
}

const orderOf = async (attemptId: string) => (await prisma.checkoutAttempt.findUniqueOrThrow({ where: { id: attemptId } })).commerceOrderId as string;
const stock = async (variantId: string) => prisma.merchandiseVariant.findUniqueOrThrow({ where: { id: variantId }, select: { remaining: true, version: true } });
const receipts = (commerceOrderId: string) => prisma.notificationOutbox.count({ where: { eventKey: `merchandise-receipt/${commerceOrderId}` } });
const tokenIn = (job: { id: string; encryptedPayload: string }) => {
  const { text } = decryptNotification(job.encryptedPayload, job.id) as { text: string };
  return { text, token: new URLSearchParams(new URL(text.split("\n\n").at(-1)!).hash.slice(1)).get("token")! };
};
async function readOrder(orderId: string, sessionId?: string) {
  const request = new Request(`http://localhost:3000/api/commerce/orders/${orderId}`, { headers: sessionId ? { cookie: `${guestCookieName}=${sessionId}` } : {} });
  const response = await commerceOrderRoute(request, routeContext({ orderId }));
  return { status: response.status, body: await parseJsonResponse(response) };
}

describe("merchandise sale", () => {
  test("two buyers race for the last unit: one holds it, the other is refused, and the paid webhook takes it from stock once", async () => {
    const { organisation, product, variants } = await shop([{ priceAmount: 4500, remaining: 1 }]);
    const items = [{ variantId: variants[0].id, quantity: 1, unitPrice: 4500 }];
    const [first, second] = await Promise.allSettled([buy(organisation.id, await member(), items), buy(organisation.id, await member(), items)]);
    const won = [first, second].filter((result) => result.status === "fulfilled");
    const lost = [first, second].filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost[0].reason).toMatchObject({ name: "MerchandiseUnavailableError", reason: "sold_out", available: 0 });

    const winner = (won[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof buy>>>).value;
    expect(winner.status).toBe("redirect");
    const commerceOrderId = await orderOf(winner.attemptId);
    const request = stripe.create.mock.calls[0][0];
    expect(request).toMatchObject({ success_url: `http://localhost:3000/merchandise/orders/${commerceOrderId}`, cancel_url: `http://localhost:3000/merchandise/orders/${commerceOrderId}?left=1` });
    expect(await prisma.commerceOrderLine.findFirst({ where: { orderId: commerceOrderId } })).toMatchObject({ merchandiseVariantId: variants[0].id, quantity: 1, unitAmount: 4500, variantSnapshot: "S0" });

    // Held, not sold: stock is untouched, but buyers see none left.
    expect(await stock(variants[0].id)).toEqual({ remaining: 1, version: 1 });
    expect((await shopProduct(organisation.id, product.id))?.variants[0].available).toBe(0);
    expect((await quoteBasket({ society: organisation.slug, items: [{ variantId: variants[0].id, quantity: 1 }] }))?.problems).toEqual([{ variantId: variants[0].id, problem: "sold_out" }]);

    await deliverPaid(commerceOrderId);
    await deliverPaid(commerceOrderId);
    expect(await stock(variants[0].id)).toEqual({ remaining: 0, version: 2 });
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: commerceOrderId } })).toMatchObject({ status: "paid", requiresCompensationReview: false });
    expect(await receipts(commerceOrderId)).toBe(1);
    // A member's receipt stays a plain business notice: their account opens the order.
    expect(await prisma.notificationOutbox.findFirst({ where: { eventKey: `merchandise-receipt/${commerceOrderId}` } })).toMatchObject({ template: "business_notice", organisationId: organisation.id, guestAccessGrantId: null });
  });

  test("baskets listing options in opposite orders both finish, and a basket one option can't fill takes nothing", async () => {
    const { organisation, variants } = await shop([{ priceAmount: 1000, remaining: 5 }, { priceAmount: 2000, remaining: 5 }, { priceAmount: 0, remaining: 2 }]);
    const [x, y, z] = variants.map((variant) => variant.id);
    const forward = [{ variantId: x, quantity: 2, unitPrice: 1000 }, { variantId: y, quantity: 1, unitPrice: 2000 }];
    const results = await Promise.all([buy(organisation.id, await member(), forward), buy(organisation.id, await member(), [...forward].reverse())]);
    expect(results.map((result) => result.status)).toEqual(["redirect", "redirect"]);
    // Two held baskets leave 1 of x and 3 of y for anyone else.
    const quote = await quoteBasket({ society: organisation.slug, items: [{ variantId: x, quantity: 10 }, { variantId: y, quantity: 10 }] });
    expect(quote?.lines.map((line) => line.available)).toEqual([1, 3]);

    // A free option in a paid basket stays off Stripe's line items.
    stripe.create.mockClear();
    await buy(organisation.id, await member(), [{ variantId: x, quantity: 1, unitPrice: 1000 }, { variantId: z, quantity: 1, unitPrice: 0 }]);
    expect(stripe.create.mock.calls[0][0].line_items).toHaveLength(1);

    const before = await prisma.commerceOrder.count({ where: { organisationId: organisation.id } });
    await expect(buy(organisation.id, await member(), [{ variantId: y, quantity: 1, unitPrice: 2000 }, { variantId: x, quantity: 1, unitPrice: 1000 }])).rejects.toMatchObject({ reason: "sold_out", variantId: x });
    expect(await prisma.commerceOrder.count({ where: { organisationId: organisation.id } })).toBe(before);
    expect((await quoteBasket({ society: organisation.slug, items: [{ variantId: y, quantity: 10 }] }))?.lines[0].available).toBe(3);
  });

  test("a free basket completes in checkout once, for a member or a verified guest, with a receipt naming the pickup", async () => {
    const { organisation, variants } = await shop([{ priceAmount: 0, remaining: 3 }, { priceAmount: 0, remaining: 3 }]);
    const items = [{ variantId: variants[0].id, quantity: 2, unitPrice: 0 }, { variantId: variants[1].id, quantity: 1, unitPrice: 0 }];
    const guest = await verifiedGuest();
    const key = unique("merch-free-key");
    const first = await buy(organisation.id, { guest }, items, key);
    const again = await buy(organisation.id, { guest }, items, key);
    expect(first.status).toBe("fulfilled");
    expect(again).toEqual(first);
    if (first.status !== "fulfilled") throw new Error("not fulfilled");
    expect(stripe.create).not.toHaveBeenCalled();
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: first.commerceOrderId } })).toMatchObject({ status: "paid", paymentKind: "free", guestIdentityId: guest.guestIdentityId, userId: null });
    expect(await stock(variants[0].id)).toEqual({ remaining: 1, version: 2 });
    expect(await stock(variants[1].id)).toEqual({ remaining: 2, version: 2 });
    expect(await receipts(first.commerceOrderId)).toBe(1);

    // More than is left is refused with what is left, and takes nothing.
    await expect(buy(organisation.id, await member(), [{ variantId: variants[0].id, quantity: 2, unitPrice: 0 }])).rejects.toMatchObject({ reason: "not_enough", available: 1 });
    expect(await stock(variants[0].id)).toEqual({ remaining: 1, version: 2 });
  });

  test("a tampered amount, an expired hold paid late and a hold that lapsed before its payment landed all go to review without taking stock", async () => {
    const { organisation, variants } = await shop([{ priceAmount: 3000, remaining: 1 }]);
    const items = [{ variantId: variants[0].id, quantity: 1, unitPrice: 3000 }];

    const tampered = await orderOf((await buy(organisation.id, await member(), items)).attemptId);
    await deliverPaid(tampered, { amount_total: 100 });
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: tampered } })).toMatchObject({ requiresCompensationReview: true, reviewReason: "amount_mismatch" });
    expect(await stock(variants[0].id)).toEqual({ remaining: 1, version: 1 });

    // The tampered order's hold is gone: the unit is on sale again.
    const expiring = await orderOf((await buy(organisation.id, await member(), items)).attemptId);
    expect((await expireStaleCommerceOrders({ now: new Date(Date.now() + 40 * 60_000) })).expired).toBeGreaterThanOrEqual(1);
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: expiring } })).toMatchObject({ status: "expired" });
    await deliverPaid(expiring);
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: expiring } })).toMatchObject({ requiresCompensationReview: true, reviewReason: "paid_after_order_closed" });
    expect(await stock(variants[0].id)).toEqual({ remaining: 1, version: 1 });

    // A payment made just before Stripe's page closed still finds its stock: the hold
    // outlives the page by the late-webhook grace, as ticket holds do (DEF-033).
    const late = await orderOf((await buy(organisation.id, await member(), items)).attemptId);
    await prisma.commerceOrder.update({ where: { id: late }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await expect(buy(organisation.id, await member(), items)).rejects.toMatchObject({ reason: "sold_out" });
    await deliverPaid(late);
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: late } })).toMatchObject({ status: "paid", requiresCompensationReview: false });
    expect(await stock(variants[0].id)).toEqual({ remaining: 0, version: 2 });
    await prisma.merchandiseVariant.update({ where: { id: variants[0].id }, data: { remaining: 1 } });

    // Past the grace too, but not yet cleaned up, a hold no longer counts: someone else buys the unit first.
    const lapsed = await orderOf((await buy(organisation.id, await member(), items)).attemptId);
    await prisma.commerceOrder.update({ where: { id: lapsed }, data: { expiresAt: new Date(Date.now() - 6 * 60_000) } });
    const sold = await orderOf((await buy(organisation.id, await member(), items)).attemptId);
    await deliverPaid(sold);
    await deliverPaid(lapsed);
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: lapsed } })).toMatchObject({ requiresCompensationReview: true, reviewReason: "sold_out" });
    expect(await stock(variants[0].id)).toEqual({ remaining: 0, version: 3 });
    expect(await receipts(lapsed)).toBe(0);
  });

  test("a refund made in Stripe before a late paid webhook sends the order to review without taking stock", async () => {
    const { organisation, variants } = await shop([{ priceAmount: 3000, remaining: 2 }]);
    const items = [{ variantId: variants[0].id, quantity: 1, unitPrice: 3000 }];
    const refunded = await orderOf((await buy(organisation.id, await member(), items)).attemptId);
    await prisma.commerceOrder.update({ where: { id: refunded }, data: { externalRefundedAmount: 3000 } });
    await deliverPaid(refunded);
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: refunded } })).toMatchObject({ status: "failed", requiresCompensationReview: true, reviewReason: "refunded_or_disputed_before_fulfilment" });
    expect(await stock(variants[0].id)).toMatchObject({ remaining: 2 });
    expect(await receipts(refunded)).toBe(0);
  });

  test("stock edits can't go below holds, and stale baskets, options no longer sold and other societies' options are refused", async () => {
    const { organisation, user, product, photo, variants } = await shop([{ priceAmount: 1500, remaining: 4 }, { priceAmount: 1500, remaining: 4 }]);
    const buyer = await member();
    // An unanswered Stripe call keeps the order, so its hold stays.
    stripe.create.mockRejectedValueOnce(Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" }));
    expect((await buy(organisation.id, buyer, [{ variantId: variants[0].id, quantity: 3, unitPrice: 1500 }])).status).toBe("processing");

    const actor = { id: user.id, authVersion: (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).authVersion };
    const edit = async (remaining: number) => {
      const current = await prisma.merchandiseProduct.findUniqueOrThrow({ where: { id: product.id } });
      const options = await prisma.merchandiseVariant.findMany({ where: { productId: product.id }, orderBy: { position: "asc" } });
      return updateProduct(actor, organisation.id, product.id, {
        name: current.name, description: "", imageAssetIds: [photo.id], expectedVersion: current.version,
        variants: options.map((option, index) => ({ id: option.id, expectedVersion: option.version, colour: "", size: option.size, sku: option.sku, priceAmount: option.priceAmount, remaining: index === 0 ? remaining : option.remaining }))
      });
    };
    await expect(edit(2)).rejects.toMatchObject({ status: 400, message: "3 are held in checkouts right now, so stock can't go below 3." });
    await edit(3);
    expect(await stock(variants[0].id)).toMatchObject({ remaining: 3 });

    const route = (selection: unknown, expectedTotal = 1500) =>
      merchandiseCheckout(jsonRequest("http://localhost:3000/api/payments/checkout/merchandise", { organisationId: organisation.id, selection, expectedTotal, idempotencyKey: unique("merch-route-key") }));
    const one = [{ variantId: variants[1].id, quantity: 1, unitPrice: 1500 }];
    // The holder's open basket blocks a second one in this society (SEC-010).
    setMockSession({ userId: buyer.userId, email: buyer.email, accountRole: "member" });
    const second = await route(selectionFor(one));
    expect(second.status).toBe(409);
    expect((await parseJsonResponse(second)).error.details[0]).toMatchObject({ reason: "purchase_in_progress" });
    const shopper = await member();
    setMockSession({ userId: shopper.userId, email: shopper.email, accountRole: "member" });
    const stale = await route({ ...selectionFor(one), quoteVersion: quoteVersion([{ ...one[0], unitPrice: 1400 }]) });
    expect(stale.status).toBe(409);
    expect((await parseJsonResponse(stale)).error.details[0]).toMatchObject({ reason: "quote_changed" });
    const held = await route(selectionFor([{ variantId: variants[0].id, quantity: 1, unitPrice: 1500 }]));
    expect((await parseJsonResponse(held)).error.details[0]).toMatchObject({ reason: "sold_out", value: 0 });

    await prisma.merchandiseVariant.update({ where: { id: variants[1].id }, data: { archivedAt: new Date() } });
    const other = await shop([{ priceAmount: 1500, remaining: 4 }]);
    for (const variantId of [variants[1].id, other.variants[0].id]) {
      const refused = await route(selectionFor([{ variantId, quantity: 1, unitPrice: 1500 }]));
      expect(refused.status).toBe(409);
      expect((await parseJsonResponse(refused)).error.details[0]).toMatchObject({ reason: "unavailable" });
    }
    expect((await route({ items: [{ variantId: variants[0].id, quantity: 1 }, { variantId: variants[0].id, quantity: 1 }], quoteVersion: "0".repeat(16) })).status).toBe(400);
  });

  test("one guest email keeps one unpaid basket per society across checkout sessions (SEC-010)", async () => {
    const { organisation, variants } = await shop([{ priceAmount: 2500, remaining: 5 }]);
    const email = `${unique("guest")}@example.com`;
    const items = [{ variantId: variants[0].id, quantity: 1, unitPrice: 2500 }];
    expect((await buy(organisation.id, { guest: await verifiedGuest(email) }, items)).status).toBe("redirect");
    await expect(buy(organisation.id, { guest: await verifiedGuest(email) }, items)).rejects.toMatchObject({ reason: "purchase_in_progress" });
    expect((await buy(organisation.id, { guest: await verifiedGuest() }, items)).status).toBe("redirect");
  });

  test("a guest's checkout session reads the order it bought, and no other session of that email, member or stranger can", async () => {
    const { organisation, variants } = await shop([{ priceAmount: 0, remaining: 5 }]);
    const read = readOrder;
    clearMockSession();
    const email = `${unique("guest")}@example.com`;
    const first = await guestSession(email);
    const bought = await buy(organisation.id, { guest: first.guest }, [{ variantId: variants[0].id, quantity: 1, unitPrice: 0 }]);
    if (bought.status !== "fulfilled") throw new Error("not fulfilled");

    const own = await read(bought.commerceOrderId, first.sessionId);
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ view: "buyer", order: { id: bought.commerceOrderId, kind: "merchandise", status: "paid", organisation: { slug: organisation.slug }, lines: [{ quantity: 1, variantSnapshot: "S0" }] } });
    expect(JSON.stringify(own.body)).not.toContain(email);

    // A later session for the same email, a member and a stranger all get nothing.
    expect((await read(bought.commerceOrderId, (await guestSession(email)).sessionId)).status).toBe(404);
    expect((await read(bought.commerceOrderId)).status).toBe(401);
    const member = await createMember();
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    expect((await read(bought.commerceOrderId)).status).toBe(404);
  });

  test("a guest's receipt link opens that one order on any device, once, and Find your purchase resends a link per paid merchandise order", async () => {
    const { organisation, variants } = await shop([{ priceAmount: 0, remaining: 5 }, { priceAmount: 2500, remaining: 5 }]);
    const free = [{ variantId: variants[0].id, quantity: 1, unitPrice: 0 }];
    const email = `${unique("guest")}@example.com`;
    const first = await buy(organisation.id, { guest: await verifiedGuest(email) }, free);
    const second = await buy(organisation.id, { guest: await verifiedGuest(email) }, free);
    const stranger = await buy(organisation.id, { guest: await verifiedGuest() }, free);
    const pending = await buy(organisation.id, { guest: await verifiedGuest(email) }, [{ variantId: variants[1].id, quantity: 1, unitPrice: 2500 }]);
    if (first.status !== "fulfilled" || second.status !== "fulfilled" || stranger.status !== "fulfilled" || pending.status !== "redirect") throw new Error("unexpected checkout");
    const pendingOrderId = await orderOf(pending.attemptId);

    // The receipt is a guest link email tied to a purchase grant for this one order.
    const receipt = await prisma.notificationOutbox.findFirstOrThrow({ where: { eventKey: `merchandise-receipt/${first.commerceOrderId}` } });
    expect(receipt).toMatchObject({ template: "guest_order_link", recipient: email, organisationId: null, userId: null, status: "pending" });
    expect(await prisma.guestAccessGrant.findUniqueOrThrow({ where: { id: receipt.guestAccessGrantId! } })).toMatchObject({ purpose: "purchase", commerceOrderId: first.commerceOrderId, orderId: null, consumedAt: null });
    const { text, token } = tokenIn(receipt);
    expect(text).toContain("Collect it in person: EngSoc office, weekdays 10 to 2");
    expect(text).toContain("Find your purchase");

    // The notification worker accepts and sends it.
    const processingToken = unique("lease");
    await prisma.notificationOutbox.update({ where: { id: receipt.id }, data: { status: "processing", processingToken, processingStartedAt: new Date() } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "synthetic-message" }), { status: 200 })));
    expect(await processNotificationClaim({ id: receipt.id, processingToken })).toBe("sent");
    vi.unstubAllGlobals();

    // Another device, no account: the link opens this order, and only once.
    clearMockSession();
    const opened = await redeemGuestAccess(token);
    expect(opened.callbackUrl).toBe(`/merchandise/orders/${first.commerceOrderId}`);
    await expect(redeemGuestAccess(token)).rejects.toThrow(GuestAccessError);
    expect(await readOrder(first.commerceOrderId, opened.sessionId)).toMatchObject({ status: 200, body: { view: "buyer", order: { id: first.commerceOrderId, status: "paid" } } });
    // Not the same email's other order, not another email's, and it can't buy.
    expect((await readOrder(second.commerceOrderId, opened.sessionId)).status).toBe(404);
    expect((await readOrder(stranger.commerceOrderId, opened.sessionId)).status).toBe(404);
    const link = (await readGuestSession(opened.sessionId))!;
    await expect(buy(organisation.id, { guest: { grantId: link.grantId, guestIdentityId: link.guestIdentityId } }, free)).rejects.toThrow(GuestAccessError);

    // Find your purchase: one fresh link per paid merchandise order of this email;
    // none for the unpaid order or the other email's order.
    const strangerGrants = await prisma.guestAccessGrant.count({ where: { commerceOrderId: stranger.commerceOrderId } });
    await requestGuestRecovery(email.toUpperCase());
    const links = await prisma.notificationOutbox.findMany({ where: { recipient: email, template: "guest_order_link", eventKey: { startsWith: "guest/" } } });
    expect(links).toHaveLength(2);
    const callbacks = await Promise.all(links.map(async (job) => (await redeemGuestAccess(tokenIn(job).token)).callbackUrl));
    expect(callbacks.sort()).toEqual([first.commerceOrderId, second.commerceOrderId].map((id) => `/merchandise/orders/${id}`).sort());
    expect(await prisma.guestAccessGrant.count({ where: { commerceOrderId: pendingOrderId } })).toBe(0);
    expect(await prisma.guestAccessGrant.count({ where: { commerceOrderId: stranger.commerceOrderId } })).toBe(strangerGrants);

    // The database keeps a purchase link to exactly one order, and a checkout link to none.
    const later = new Date(Date.now() + 60_000);
    const guestIdentityId = link.guestIdentityId;
    await expect(prisma.guestAccessGrant.create({ data: { guestIdentityId, purpose: "purchase", tokenDigest: unique("digest"), expiresAt: later } })).rejects.toThrow();
    await expect(prisma.guestAccessGrant.create({ data: { guestIdentityId, purpose: "checkout", commerceOrderId: first.commerceOrderId, tokenDigest: unique("digest"), expiresAt: later } })).rejects.toThrow();
  });

  test("through the routes, a guest checks out and cancels with a live checkout session and its CSRF token; memberships never take a guest", async () => {
    const { organisation, variants } = await shop([{ priceAmount: 2500, remaining: 5 }]);
    const items = [{ variantId: variants[0].id, quantity: 1, unitPrice: 2500 }];
    clearMockSession();
    const buyer = await guestSession();
    const headers = (sessionId: string, csrf = guestCsrfToken(sessionId)) => ({ cookie: `${guestCookieName}=${sessionId}`, "x-thunderstrux-guest-csrf": csrf });
    const body = () => ({ organisationId: organisation.id, selection: selectionFor(items), expectedTotal: totalOf(items), idempotencyKey: unique("merch-route-key") });
    const checkout = (sessionId: string, csrf?: string) =>
      merchandiseCheckout(jsonRequest("http://localhost:3000/api/payments/checkout/merchandise", body(), { headers: headers(sessionId, csrf) }));

    expect((await checkout(buyer.sessionId, "0".repeat(64))).status).toBe(403);
    expect((await checkout("D".repeat(43))).status).toBe(401);
    expect((await membershipCheckout(jsonRequest("http://localhost:3000/api/payments/checkout/membership", { ...body(), selection: {} }, { headers: headers(buyer.sessionId) }))).status).toBe(401);
    expect(await prisma.commerceOrder.count()).toBe(0);
    expect(await parseJsonResponse(await checkout(buyer.sessionId))).toEqual({ kind: "stripe", url: "https://checkout.stripe.test/pay" });
    const order = await prisma.commerceOrder.findFirstOrThrow();
    expect(order).toMatchObject({ userId: null, guestIdentityId: buyer.guest.guestIdentityId, status: "pending" });

    const cancel = (sessionId: string, csrf?: string) =>
      cancelCommerce(jsonRequest(`http://localhost:3000/api/commerce/orders/${order.id}/cancel`, {}, { headers: headers(sessionId, csrf) }), routeContext({ orderId: order.id }));
    expect((await cancel(buyer.sessionId, "0".repeat(64))).status).toBe(403);
    stripe.retrieve.mockResolvedValue({ id: order.stripeSessionId, status: "open", payment_status: "unpaid" });
    stripe.expire.mockResolvedValue({ id: order.stripeSessionId, status: "expired", payment_status: "unpaid" });
    expect(await parseJsonResponse(await cancel(buyer.sessionId))).toEqual({ status: "cancelled" });
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "expired", failureReason: "buyer_cancelled" });
    // A later session for the same email didn't buy it.
    expect((await cancel((await guestSession(buyer.email)).sessionId)).status).toBe(404);
  });
});
