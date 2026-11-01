import { execFileSync } from "node:child_process";
import Stripe from "stripe";
import type { APIRequestContext, Browser } from "@playwright/test";
import { test, expect, prisma, login, selectStaffContext, createEvent, createMember } from "./fixtures";
import { localDay } from "@/components/calendar/layout";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { heldMoney } from "@/lib/payouts/release";
import { createMembershipGrant } from "@/tests/helpers/test-data";

// T44a: connected section 7 journeys against the release images (web for the
// app, ops for migrations and workers). Each one fills a gap the per-feature
// specs leave between them; docs/obsidian/Journey Qualification.md maps every
// section 7 requirement to the test that proves it. They run in the campaign's
// webhook step (a synthetic test key, no Stripe account): provider outcomes
// arrive as signed webhooks, exactly as Stripe would send them.

const stripe = new Stripe("sk_test_synthetic");
const secret = "whsec_e2e_synthetic";

function signedEvent(request: APIRequestContext, type: string, object: unknown) {
  const body = JSON.stringify({ id: `evt_${crypto.randomUUID()}`, object: "event", type, created: Math.floor(Date.now() / 1000), livemode: false, data: { object } });
  return request.post("/api/payments/webhook", { headers: { "content-type": "application/json", "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload: body, secret }) }, data: body });
}

// The newest emailed link for an address, after the notification worker sends what is queued.
async function emailedLink(request: APIRequestContext, to: string, subject: string) {
  execFileSync("node", ["scripts/process-notifications.mjs"], { stdio: "pipe" });
  const messages = await (await request.get("http://mail-capture:8025/messages")).json();
  const message = messages.filter((item: { data: { to: string; subject: string } }) => item.data.to === to && item.data.subject.includes(subject)).at(-1);
  expect(message, `an email "${subject}" to ${to}`).toBeTruthy();
  return message.data.text.split("\n\n").at(-1) as string;
}

const otherBrowser = (browser: Browser) => browser.newContext({ baseURL: "http://localhost:3100" });

test("a guest pays for tickets, opens them from another browser, is admitted once, and after a refund the tickets are turned away", async ({ page, data, browser }) => {
  await prisma.organisation.update({ where: { id: data.organisation.id }, data: { stripeAccountId: "acct_e2e_journeys", stripeChargesEnabled: true, supportEmail: "help@society.example", refundPolicy: "Refunds up to a week before." } });
  const event = await createEvent({ organisationId: data.organisation.id, status: "published", title: "Paid Guest Quiz Night", ticketTypes: [{ name: "Standard", price: 1500, quantity: 20 }] });
  const ticketType = event.ticketTypes[0];
  const email = `paying-guest-${Date.now()}@example.com`;

  // 1. The guest confirms their email from the link, as at checkout.
  await page.goto(`/events/${event.id}`);
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("First name").fill("Gia");
  await page.getByLabel("Last name").fill("Guest");
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("status")).toContainText(email);
  await page.goto(await emailedLink(page.request, email, "Confirm your email"));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Review your order" })).toBeVisible();
  await expect(page.getByText("Buying as a guest")).toBeVisible();
  const identity = await prisma.guestIdentity.findUniqueOrThrow({ where: { email } });
  expect(identity.verifiedAt).not.toBeNull();

  // 2. The Stripe Session this checkout would open, held for two tickets (the
  // browser campaign has no Stripe), then paid: Stripe's signed webhook fulfils it.
  const now = new Date();
  const order = await prisma.order.create({ data: {
    organisationId: data.organisation.id, eventId: event.id, ticketTypeId: ticketType.id, quantity: 2, unitPrice: 1500, totalAmount: 3000,
    status: "pending", stripeSessionId: `cs_e2e_${crypto.randomUUID()}`, guestIdentityId: identity.id, paymentKind: "stripe", compensationRefundModeSnapshot: "manual_review",
    purchasedTicketTypeName: "Standard", sellerName: data.organisation.name, buyerEmailSnapshot: email, buyerIdentityCapturedAt: now, buyerIdentityProvenance: "verified_guest"
  } });
  await prisma.ticketReservation.create({ data: { orderId: order.id, organisationId: data.organisation.id, eventId: event.id, ticketTypeId: ticketType.id, quantity: 2, expiresAt: new Date(Date.now() + 30 * 60000) } });
  const session = { id: order.stripeSessionId, object: "checkout.session", payment_status: "paid", amount_total: 3000, currency: "aud", metadata: { orderId: order.id, organisationId: data.organisation.id, eventId: event.id, ticketTypeId: ticketType.id, quantity: "2" } };
  expect((await signedEvent(page.request, "checkout.session.completed", session)).status()).toBe(200);
  const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { tickets: { orderBy: { issueSequence: "asc" } }, emailOutboxJobs: true } });
  expect(paid).toMatchObject({ status: "paid", userId: null, guestIdentityId: identity.id });
  expect(paid.tickets).toHaveLength(2);
  expect(paid.emailOutboxJobs).toHaveLength(1);
  const [first, second] = paid.tickets;

  // 3. From another browser the order address alone shows nothing; Find your purchase opens it.
  const guestElsewhere = await otherBrowser(browser);
  const stranger = await otherBrowser(browser);
  const door = await otherBrowser(browser);
  try {
    const strangerPage = await stranger.newPage();
    await strangerPage.goto(`/guest/orders/${order.id}`);
    await expect(strangerPage.getByRole("heading", { name: "Open your order from your email" })).toBeVisible();
    await expect(strangerPage.getByText("Paid Guest Quiz Night")).toHaveCount(0);

    const guest = await guestElsewhere.newPage();
    await guest.goto("/guest/recover");
    await guest.getByLabel("Email").fill(email);
    await guest.getByRole("button", { name: "Send my links" }).click();
    await expect(guest.getByRole("status")).toContainText("we've sent a link for each one");
    await guest.goto(await emailedLink(guest.request, email, "Your Thunderstrux order"));
    await guest.getByRole("button", { name: "Continue" }).click();
    await expect(guest).toHaveURL(`http://localhost:3100/guest/orders/${order.id}`);
    await expect(guest.getByRole("heading", { name: "You're going to Paid Guest Quiz Night" })).toBeVisible();
    const tickets = guest.getByRole("region", { name: "Your tickets" });
    await expect(tickets.getByRole("listitem")).toHaveCount(2);
    await expect(tickets).toContainText("$30.00");
    await expect(guest.getByText("Refunds up to a week before.")).toBeVisible();

    // 4. Check-in staff admit the first ticket, once.
    await prisma.organisationStaff.update({ where: { id: data.staff.id }, data: { role: "check_in_staff" } });
    const staff = await door.newPage();
    await login(staff, data.manager.email);
    await selectStaffContext(staff, data.organisation.id);
    await staff.goto(`/dashboard/events/${event.id}/tickets`);
    const results = staff.getByRole("list", { name: "Matching tickets" });
    await staff.getByLabel("Find a ticket").fill(first.id.slice(-6).toUpperCase());
    await results.getByRole("button", { name: /^Check in/ }).click();
    await expect(results.getByRole("listitem")).toContainText("Checked in just now");
    expect(await prisma.auditLog.count({ where: { targetId: first.id, action: "ticket.checked_in" } })).toBe(1);

    // 5. Finance refunds the order: Stripe confirms with a signed refund event, twice.
    const intent = `pi_e2e_${order.id}`;
    const refundRequest = await prisma.refundRequest.create({ data: {
      orderId: order.id, organisationId: data.organisation.id, amount: 3000, reason: "Guest can no longer attend.", actorUserId: data.owner.id,
      operationKey: `order-refund:e2e-${order.id}`, status: "pending", stripePaymentIntentId: intent
    } });
    await prisma.order.update({ where: { id: order.id }, data: { refundStatus: "processing", stripePaymentIntentId: intent } });
    const refund = { id: `re_e2e_${order.id}`, object: "refund", amount: 3000, currency: "aud", status: "succeeded", payment_intent: intent, metadata: { refundRequestId: refundRequest.id, orderId: order.id } };
    for (let attempt = 0; attempt < 2; attempt += 1) expect((await signedEvent(guest.request, "refund.updated", refund)).status()).toBe(200);
    const refunded = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { tickets: true } });
    expect(refunded.refundStatus).toBe("refunded");
    expect(refunded.tickets.every((ticket) => ticket.validity === "void" && ticket.validityReason === "refunded")).toBe(true);
    expect(await prisma.stripeRefundWebhookEvent.count({ where: { refundRequestId: refundRequest.id } })).toBe(2);
    expect((await prisma.refundRequest.findUniqueOrThrow({ where: { id: refundRequest.id } })).status).toBe("succeeded");

    // 6. The guest's page says it was refunded and shows no tickets for the door.
    await guest.reload();
    await expect(guest.getByRole("heading", { name: "Your order" })).toBeVisible();
    await expect(guest.getByText("$30.00 was refunded to your card", { exact: false })).toBeVisible();
    await expect(guest.getByRole("region", { name: "Your tickets" })).toHaveCount(0);
    for (const width of [390, 1280]) {
      await guest.setViewportSize({ width, height: 900 });
      expect(await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await guest.screenshot({ path: `test-results/journey-guest-refunded-${width}.png`, fullPage: true });
    }

    // 7. At the door the second ticket is turned away, and says why.
    await staff.getByLabel("Find a ticket").fill(second.id.slice(-6).toUpperCase());
    await expect(results.getByRole("listitem", { name: /Don't admit/ })).toContainText("Refunded on");
    await expect(results.getByRole("button", { name: /^Check in/ })).toHaveCount(0);
  } finally {
    await Promise.all([guestElsewhere.close(), stranger.close(), door.close()]);
  }
});

test("a member's free join gives no member price, a paid membership does and survives leaving the society, and refunding it ends both", async ({ page, data }) => {
  const event = await createEvent({ organisationId: data.organisation.id, status: "published", title: "Members Price Gala", ticketTypes: [{ name: "Standard", price: 1500, quantity: 20, memberPrice: 900 }] });
  const ticketType = event.ticketTypes[0];
  const checkout = `/events/${event.id}/checkout?ticketTypeId=${ticketType.id}&quantity=1`;
  const quotes = async (member: boolean) => {
    await page.goto(`/events/${event.id}`);
    if (member) await expect(page.getByText("Member price through your", { exact: false })).toBeVisible();
    else await expect(page.getByText(/Members pay \$9\.00/)).toBeVisible();
    await page.goto(checkout);
    await expect(page.getByRole("heading", { name: "Review your order" })).toBeVisible();
    await expect(page.getByText("Standard (member price)")).toHaveCount(member ? 1 : 0);
    await expect(page.getByText(member ? "$9.00" : "$15.00").first()).toBeVisible();
  };

  // 1. Signed in, not joined: the standard price, and the member price named.
  await login(page, data.member.email, `/societies/${data.organisation.slug}`);
  await quotes(false);

  // 2. A free join follows the society; it is not a membership.
  await page.goto(`/societies/${data.organisation.slug}`);
  await page.getByRole("button", { name: "Join society", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^You've joined / })).toBeVisible();
  await quotes(false);

  // 3. A paid term membership (its Stripe checkout fulfilled, as the commerce webhook would) brings the member price.
  const startsAt = new Date(Date.now() - 86_400_000);
  const endsAt = new Date(Date.now() + 120 * 86_400_000);
  const plan = await prisma.membershipProduct.create({ data: { organisationId: data.organisation.id, name: "Gala Season Membership", priceAmount: 2500, startsAt, endsAt, entitlements: ["member_prices"], status: "published", publishedAt: new Date() } });
  const purchase = await prisma.$transaction((tx) => createCommerceOrder(tx, {
    organisationId: data.organisation.id, kind: "membership", buyer: { userId: data.member.id }, buyerEmail: data.member.email, paymentKind: "stripe", source: "checkout",
    lines: [{ quantity: 1, unitAmount: 2500, name: plan.name, termStartsAt: startsAt, termEndsAt: endsAt, membershipProductId: plan.id }]
  }));
  const intent = `pi_e2e_${purchase.id}`;
  await prisma.commerceOrder.update({ where: { id: purchase.id }, data: { status: "paid", paidAt: new Date(), fulfilledAt: new Date(), stripeSessionId: `cs_e2e_${purchase.id}`, stripePaymentIntentId: intent } });
  const line = await prisma.commerceOrderLine.findFirstOrThrow({ where: { orderId: purchase.id } });
  const grant = await prisma.membershipGrant.create({ data: { userId: data.member.id, organisationId: data.organisation.id, membershipProductId: plan.id, commerceOrderLineId: line.id, startsAt, endsAt, entitlements: ["member_prices"], entitlementVersion: 3 } });
  await quotes(true);

  // 4. Leaving the society ends the follow, not the paid membership.
  await page.goto("/dashboard/organisations");
  const joined = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your joined societies", exact: true }) }).locator("article").filter({ has: page.getByRole("heading", { name: data.organisation.name, exact: true }) });
  await joined.getByRole("button", { name: "Leave society", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Leave society", exact: true }).click();
  await expect(joined).toHaveCount(0);
  expect(await prisma.organisationMember.count({ where: { userId: data.member.id, organisationId: data.organisation.id } })).toBe(0);
  await page.goto("/memberships");
  await expect(page.getByRole("heading", { name: "Gala Season Membership" })).toBeVisible();
  await quotes(true);

  // 5. Refunding the membership (Stripe's signed refund event) revokes it and the member price with it.
  const refundRequest = await prisma.refundRequest.create({ data: {
    commerceOrderId: purchase.id, organisationId: data.organisation.id, amount: 2500, reason: "Member moved away.", actorUserId: data.owner.id,
    operationKey: `commerce-refund:e2e-${purchase.id}`, status: "pending", stripePaymentIntentId: intent
  } });
  await prisma.commerceOrder.update({ where: { id: purchase.id }, data: { refundStatus: "processing" } });
  const refund = { id: `re_e2e_${purchase.id}`, object: "refund", amount: 2500, currency: "aud", status: "succeeded", payment_intent: intent, metadata: { refundRequestId: refundRequest.id, commerceOrderId: purchase.id } };
  expect((await signedEvent(page.request, "refund.updated", refund)).status()).toBe(200);
  expect((await prisma.membershipGrant.findUniqueOrThrow({ where: { id: grant.id } })).revokedAt).not.toBeNull();
  await page.goto("/memberships?view=revoked");
  await expect(page.getByRole("heading", { name: "Gala Season Membership" })).toBeVisible();
  await quotes(false);
});

test("a society sells with a code and a member price, refunds one ticket, cancels the event, and holds the money until each refund lands", async ({ page, data, browser }) => {
  const organisationId = data.organisation.id;
  const account = "acct_e2e_cancelled";
  await prisma.organisation.update({ where: { id: organisationId }, data: { stripeAccountId: account, stripeChargesEnabled: true, stripePayoutsEnabled: true } });
  const event = await createEvent({ organisationId, status: "published", title: "Harbour Cruise", ticketTypes: [{ name: "Standard", price: 2000, quantity: 20, memberPrice: 1200 }] });
  const ticketType = event.ticketTypes[0];
  const code = await prisma.ticketCode.create({ data: { eventId: event.id, code: "SPONSOR", percentOff: 25 } });
  const checkout = (query: string) => `/events/${event.id}/checkout?ticketTypeId=${ticketType.id}&${query}`;

  // The Session each checkout would open (this campaign has no Stripe), held, then paid: Stripe's signed webhook fulfils it.
  const pay = async (buyer: { id: string; email: string }, quantity: number, unitPrice: number, feeAmount: number, terms: object = {}) => {
    const id = crypto.randomUUID();
    const order = await prisma.order.create({ data: {
      organisationId, eventId: event.id, ticketTypeId: ticketType.id, userId: buyer.id, quantity, unitPrice, totalAmount: quantity * unitPrice, feeAmount, status: "pending",
      stripeSessionId: `cs_e2e_${id}`, stripePaymentIntentId: `pi_e2e_${id}`, paymentKind: "stripe", compensationRefundModeSnapshot: "manual_review", purchasedTicketTypeName: "Standard",
      sellerName: data.organisation.name, sellerStripeAccountId: account, buyerEmailSnapshot: buyer.email, buyerIdentityCapturedAt: new Date(), buyerIdentityProvenance: "purchase", ...terms
    } });
    await prisma.ticketReservation.create({ data: { orderId: order.id, organisationId, eventId: event.id, ticketTypeId: ticketType.id, userId: buyer.id, quantity, expiresAt: new Date(Date.now() + 30 * 60000) } });
    const session = { id: order.stripeSessionId, object: "checkout.session", payment_status: "paid", amount_total: order.totalAmount, currency: "aud", metadata: { orderId: order.id, organisationId, eventId: event.id, ticketTypeId: ticketType.id, quantity: String(quantity) } };
    expect((await signedEvent(page.request, "checkout.session.completed", session)).status()).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("paid");
    return order;
  };
  const refunded = (request: { id: string; amount: number; orderId: string | null }, intent: string | null) =>
    signedEvent(page.request, "refund.updated", { id: `re_e2e_${request.id}`, object: "refund", amount: request.amount, currency: "aud", status: "succeeded", payment_intent: intent, metadata: { refundRequestId: request.id, orderId: request.orderId } });

  // 1. A buyer with a code sees it on the event and at checkout.
  await login(page, data.member.email, `/events/${event.id}?code=SPONSOR`);
  await expect(page.getByText("$15.00").first()).toBeVisible();
  await page.goto(checkout("quantity=1&code=SPONSOR"));
  await expect(page.getByText("Standard (code SPONSOR)")).toBeVisible();
  const coded = await pay(data.member, 1, 1500, 100, { ticketCodeId: code.id, codeSnapshot: "SPONSOR", discountAmount: 500 });

  const memberContext = await otherBrowser(browser);
  const ownerContext = await otherBrowser(browser);
  try {
    // 2. A member buys twice: their one ticket at the member price, then two at the standard price.
    const member = await createMember();
    const grant = await createMembershipGrant(organisationId, member.id, member.email);
    const memberPage = await memberContext.newPage();
    await login(memberPage, member.email, checkout("quantity=1"));
    await expect(memberPage.getByText("Standard (member price)")).toBeVisible();
    const memberPriced = await pay(member, 1, 1200, 100, { membershipGrantId: grant.id, membershipEntitlementVersion: grant.entitlementVersion });
    await memberPage.goto(`/events/${event.id}`);
    await expect(memberPage.getByText("Yours is used or in an open checkout", { exact: false })).toBeVisible();
    await memberPage.goto(checkout("quantity=2"));
    await expect(memberPage.getByRole("button", { name: "Pay A$40.00" })).toBeVisible();
    const pair = await pay(member, 2, 2000, 200);

    // 3. One of the pair is refunded: Stripe's signed event voids that ticket alone.
    const [gone, kept] = await prisma.ticket.findMany({ where: { orderId: pair.id }, orderBy: { issueSequence: "asc" } });
    const one = await prisma.refundRequest.create({ data: {
      orderId: pair.id, organisationId, amount: 2000, reason: "One friend can no longer come.", actorUserId: data.owner.id, ticketIds: [gone.id],
      operationKey: `order-refund:e2e-${pair.id}`, status: "pending", stripePaymentIntentId: pair.stripePaymentIntentId
    } });
    await prisma.order.update({ where: { id: pair.id }, data: { refundStatus: "processing" } });
    expect((await refunded(one, pair.stripePaymentIntentId)).status()).toBe(200);
    expect(await prisma.ticket.findUniqueOrThrow({ where: { id: gone.id } })).toMatchObject({ validity: "void", validityReason: "refunded" });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: kept.id } })).validity).toBe("active");
    const shares = 1500 - 100 + (1200 - 100) + (4000 - 200 - 1900);
    expect((await heldMoney(organisationId, account)).total).toBe(shares);

    // 4. The owner cancels from the event's page. Every order is refunded for what is left, and the door turns it away meanwhile.
    const owner = await ownerContext.newPage();
    await login(owner, data.owner.email, `/dashboard/events/${event.id}`);
    await owner.getByRole("button", { name: "Cancel event" }).click();
    const dialog = owner.getByRole("dialog");
    await dialog.getByLabel("Message to ticket holders").fill("The harbour is closed for storm repairs.");
    await dialog.getByLabel("Type Harbour Cruise to confirm").fill("Harbour Cruise");
    await dialog.getByRole("button", { name: "Cancel event" }).click();
    await expect(dialog).toHaveCount(0);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).cancelledAt).not.toBeNull();
    const requests = await prisma.refundRequest.findMany({ where: { organisationId, status: "pending" }, orderBy: { amount: "asc" } });
    expect(requests.map((request) => [request.orderId, request.amount])).toEqual([[memberPriced.id, 1200], [coded.id, 1500], [pair.id, 2000]]);

    await owner.goto(`/dashboard/events/${event.id}/tickets`);
    await owner.getByLabel("Find a ticket").fill(kept.id.slice(-6).toUpperCase());
    const results = owner.getByRole("list", { name: "Matching tickets" });
    await expect(results.getByRole("listitem", { name: /Don't admit/ })).toContainText("This event is cancelled.");
    await expect(results.getByRole("button", { name: /^Check in/ })).toHaveCount(0);

    // 5. Its money stays held until each refund lands, then none does.
    expect((await heldMoney(organisationId, account)).total).toBe(shares);
    for (const request of requests) {
      const intent = (await prisma.order.findUniqueOrThrow({ where: { id: request.orderId as string } })).stripePaymentIntentId;
      await prisma.refundRequest.update({ where: { id: request.id }, data: { stripePaymentIntentId: intent } });
      expect((await refunded(request, intent)).status()).toBe(200);
    }
    expect((await heldMoney(organisationId, account)).total).toBe(0);
    expect(await prisma.ticket.count({ where: { eventId: event.id, validity: { not: "void" } } })).toBe(0);

    // 6. The calendar says it is off.
    await owner.goto(`/dashboard/calendar?date=${localDay(event.startTime, "Australia/Brisbane")}`);
    await expect(owner.getByRole("link", { name: /Harbour Cruise/ }).first()).toContainText("Cancelled");
  } finally {
    await Promise.all([memberContext.close(), ownerContext.close()]);
  }
});
