import { execFileSync } from "node:child_process";
import sharp from "sharp";
import type { APIRequestContext, Page } from "@playwright/test";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { test, expect, login, prisma, selectStaffContext } from "./fixtures";

async function shoot(page: Page, name: string) {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/merchandise-${name}-${width}.png`, fullPage: true });
  }
}

// T25: an owner drafts a product with a photo and two options, sees the
// publish check, publishes it and archives it.
test("an owner drafts a product with a photo and options, publishes it and archives it", async ({ page, data }) => {
  await prisma.organisation.update({ where: { id: data.organisation.id }, data: { pickupPolicy: "EngSoc office, Level 2. Tuesdays and Thursdays, 12 to 2 pm." } });
  await login(page, data.owner.email, "/dashboard/merchandise");
  await expect(page.getByRole("heading", { name: "No products yet" })).toBeVisible();
  await page.getByRole("link", { name: "New product" }).first().click();
  await expect(page.getByRole("heading", { name: "New product", level: 1 })).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill("EngSoc hoodie");
  const png = await sharp({ create: { width: 40, height: 50, channels: 3, background: "#1f2a44" } }).png().toBuffer();
  await page.locator('input[type="file"]').setInputFiles({ name: "hoodie.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("img", { name: "EngSoc hoodie, photo 1 of 1" })).toBeVisible();

  const options = page.locator("#variants li");
  await options.nth(0).getByLabel("Colour").fill("Navy");
  await options.nth(0).getByLabel("Size").fill("L");
  await options.nth(0).getByLabel("Price").fill("45");
  await options.nth(0).getByLabel("Stock left").fill("5");
  await page.getByRole("button", { name: "Add option" }).click();
  await options.nth(1).getByLabel("Colour").fill("Sticker pack");
  await options.nth(1).getByLabel("Price").fill("0");
  await options.nth(1).getByLabel("Stock left").fill("20");
  await page.getByRole("button", { name: "Save draft" }).click();

  await expect(page.getByRole("heading", { name: "EngSoc hoodie", level: 1 })).toBeVisible();
  await expect(options.nth(0).getByLabel("SKU")).toHaveValue("ENGSOC-HOODIE-NAVY-L");
  // Paid options wait for payments; the free one in stock lets it publish.
  await expect(page.getByText("Ready to publish")).toBeVisible();
  await shoot(page, "editor");

  await page.getByRole("button", { name: "Publish product" }).click();
  await expect(page.getByRole("heading", { name: "On sale" })).toBeVisible();
  await page.goto("/dashboard/merchandise");
  await expect(page.getByRole("link", { name: "EngSoc hoodie" }).first()).toBeVisible();
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
  await shoot(page, "products");

  // T26: a visitor who isn't signed in shops it.
  await page.context().clearCookies();
  const shop = `/societies/${data.organisation.slug}/merchandise`;
  await page.goto(shop);
  await expect(page.getByRole("link", { name: "Merchandise" }).first()).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Buy online, collect in person.")).toBeVisible();
  await shoot(page, "shop");
  await page.getByRole("link", { name: /EngSoc hoodie/ }).click();
  await expect(page.getByRole("heading", { name: "EngSoc hoodie", level: 1 })).toBeVisible();
  await expect(page.getByText("only 5 left")).toBeVisible();
  await page.getByRole("button", { name: "One more" }).click();
  await page.getByRole("button", { name: "Add to basket · $90.00" }).click();
  await expect(page.getByText("Added 2 × EngSoc hoodie (Navy, L) to your basket.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Basket · 2 items" })).toBeVisible();
  await shoot(page, "product");
  // The free option, then the basket: re-quoted by the server.
  await page.getByText("Sticker pack", { exact: true }).click();
  await page.getByRole("button", { name: "Add to basket · Free" }).click();
  await page.getByRole("link", { name: "View basket" }).click();
  await expect(page.getByRole("heading", { name: /merchandise basket/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Checkout merchandise" })).toBeVisible();
  await expect(page.getByText("3 items")).toBeVisible();
  await page.getByRole("group", { name: "Quantity of EngSoc hoodie, Navy · L" }).getByRole("button", { name: "One fewer" }).click();
  await expect(page.getByText("2 items")).toBeVisible();
  await shoot(page, "basket");
  // Another society's item asks before mixing baskets.
  await page.evaluate(() => localStorage.setItem("thunderstrux:merchandise-basket", JSON.stringify({ society: "another-society", lines: [{ variantId: "x", quantity: 1 }] })));
  await page.goto(shop);
  await page.getByRole("link", { name: /EngSoc hoodie/ }).click();
  await page.getByRole("button", { name: /Add to basket/ }).click();
  await expect(page.getByRole("dialog").getByText("Your basket has another society's items")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Clear and add this" }).click();
  await expect(page.getByRole("link", { name: "Basket · 1 item" })).toBeVisible();

  await login(page, data.owner.email, "/dashboard/merchandise");
  await page.getByRole("link", { name: "Edit EngSoc hoodie" }).first().click();

  await page.getByRole("button", { name: "Archive product" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive product" }).click();
  await expect(page.getByRole("button", { name: "Restore as draft" })).toBeVisible();
  expect(await prisma.merchandiseProduct.findFirstOrThrow({ where: { organisationId: data.organisation.id } })).toMatchObject({ status: "archived" });
});

test("staff without merchandise:manage see no Merchandise item and get not found", async ({ page, data }) => {
  await login(page, data.manager.email, "/dashboard");
  await selectStaffContext(page, data.organisation.id);
  await expect(page.getByRole("navigation", { name: "Organisation navigation" }).getByRole("link", { name: "Events" }).first()).toBeAttached();
  await expect(page.getByRole("link", { name: "Merchandise" })).toHaveCount(0);
  expect((await page.goto("/dashboard/merchandise"))?.status()).toBe(404);
});

// The newest emailed link for an address, after the notification worker sends what is queued.
async function emailedLink(request: APIRequestContext, to: string, subject: string) {
  execFileSync("node", ["scripts/process-notifications.mjs"], { stdio: "pipe" });
  const messages = await (await request.get("http://mail-capture:8025/messages")).json();
  const message = messages.filter((item: { data: { to: string; subject: string } }) => item.data.to === to && item.data.subject.includes(subject)).at(-1);
  expect(message, `an email "${subject}" to ${to}`).toBeTruthy();
  return message.data.text.split("\n\n").at(-1) as string;
}

// T27b: a guest checks out a free basket after confirming their email; a
// member reviews a paid one; the order page shows each payment state.
test("a guest checks out free merchandise, a member reviews a paid basket, and the order page shows each state", async ({ page, data, browser }) => {
  const { organisation } = data;
  await prisma.organisation.update({ where: { id: organisation.id }, data: { pickupPolicy: "EngSoc office, Level 2. Tuesdays and Thursdays, 12 to 2 pm.", refundPolicy: "Unworn items within 14 days." } });
  const now = new Date();
  const product = await prisma.merchandiseProduct.create({ data: { organisationId: organisation.id, name: "Sticker pack", status: "published", publishedAt: now, firstPublishedAt: now } });
  const free = await prisma.merchandiseVariant.create({ data: { productId: product.id, organisationId: organisation.id, sku: `E2E-FREE-${Date.now()}`, priceAmount: 0, remaining: 5 } });
  const paid = await prisma.merchandiseVariant.create({ data: { productId: product.id, organisationId: organisation.id, size: "Large", sku: `E2E-PAID-${Date.now()}`, priceAmount: 4500, remaining: 5, position: 1 } });
  const basket = (variantId: string, quantity: number) =>
    page.evaluate(([society, id, count]) => localStorage.setItem("thunderstrux:merchandise-basket", JSON.stringify({ society, lines: [{ variantId: id, quantity: count }] })), [organisation.slug, variantId, quantity] as const);
  const checkout = `/societies/${organisation.slug}/merchandise/checkout`;

  // A guest: email first, then back from the link to confirm.
  const email = `merch-guest-${Date.now()}@example.com`;
  await page.goto(`/societies/${organisation.slug}/merchandise`);
  await basket(free.id, 2);
  await page.goto(`/societies/${organisation.slug}/merchandise/basket`);
  await page.getByRole("link", { name: "Checkout merchandise" }).click();
  await expect(page.getByRole("heading", { name: "Where should we send your receipt?" })).toBeVisible();
  await expect(page.getByText("2 items from")).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("First name").fill("Gia");
  await page.getByLabel("Last name").fill("Guest");
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("status")).toContainText(email);
  await shoot(page, "guest-email");
  await page.goto(await emailedLink(page.request, email, "Confirm your email"));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Confirm your order" })).toBeVisible();
  await expect(page.getByText("Buying as a guest")).toBeVisible();
  await expect(page.getByText("EngSoc office, Level 2.")).toBeVisible();
  await shoot(page, "guest-review");
  await page.getByRole("button", { name: "Confirm free order" }).click();
  await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
  await expect(page.getByText("2 × Sticker pack")).toBeVisible();
  await expect(page.getByText(/Free · Order [A-Z0-9]{6}/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("thunderstrux:merchandise-basket"))).toBeNull();
  expect((await prisma.merchandiseVariant.findUniqueOrThrow({ where: { id: free.id } })).remaining).toBe(3);
  await shoot(page, "order-confirmed");

  // Another browser with no session: the receipt's link opens this one order.
  const orderPath = new URL(page.url()).pathname;
  const other = await browser.newContext({ baseURL: "http://localhost:3100" });
  try {
    const device = await other.newPage();
    await device.goto(await emailedLink(device.request, email, "Your Thunderstrux order"));
    await device.getByRole("button", { name: "Continue" }).click();
    await expect(device.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
    expect(new URL(device.url()).pathname).toBe(orderPath);
    await expect(device.getByRole("link", { name: "Find your purchase" })).toBeVisible();
    await shoot(device, "receipt-link");
  } finally {
    await other.close();
  }

  // A member's paid basket: the review names the price; this society can't take payments, and says nothing was charged.
  await login(page, data.member.email, checkout);
  await basket(paid.id, 1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Review your order" })).toBeVisible();
  await expect(page.getByText("We hold these items for 30 minutes while you pay.")).toBeVisible();
  await shoot(page, "review");
  await page.getByRole("button", { name: "Pay $45.00" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Checkout didn't start" })).toContainText("Nothing has been charged.");

  // The order page for a member's paid order: confirming, left Stripe, and held for review.
  const order = await prisma.$transaction((tx) => createCommerceOrder(tx, {
    organisationId: organisation.id, kind: "merchandise", buyer: { userId: data.member.id }, buyerEmail: data.member.email, paymentKind: "stripe", feeAmount: 450,
    lines: [{ quantity: 1, unitAmount: 4500, name: "Sticker pack", variant: "Large", merchandiseVariantId: paid.id }], source: "checkout", expiresAt: new Date(Date.now() + 30 * 60_000)
  }));
  // Not paid yet (round E1): it says so, with Cancel order while the hold lasts.
  await page.goto(`/merchandise/orders/${order.id}`);
  await expect(page.getByRole("heading", { name: "You haven't paid yet" })).toBeVisible();
  await expect(page.getByText("Waiting for payment")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel order" })).toBeVisible();
  await shoot(page, "order-waiting");
  await page.goto(`/merchandise/orders/${order.id}?left=1`);
  await expect(page.getByText("You left Stripe before paying, so nothing was charged.", { exact: false })).toBeVisible();
  // Once the hold has ended, nothing is held and the basket is still there.
  await prisma.commerceOrder.update({ where: { id: order.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
  await page.goto(`/merchandise/orders/${order.id}`);
  await expect(page.getByRole("heading", { name: "No payment taken" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to basket" }).last()).toBeVisible();
  await prisma.commerceOrder.update({ where: { id: order.id }, data: { status: "failed", requiresCompensationReview: true, reviewReason: "sold_out", paidAt: new Date(), failedAt: new Date() } });
  await page.goto(`/merchandise/orders/${order.id}`);
  await expect(page.getByRole("heading", { name: "We're refunding your payment" })).toBeVisible();

  // Someone else's order is not found.
  await page.context().clearCookies();
  await login(page, data.manager.email, `/merchandise/orders/${order.id}`);
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
});

// T28a: the owner marks a paid order ready, then collected, and the buyer's order page follows.
test("an owner marks an order ready and collected on the Pickups tab, and the buyer sees each step", async ({ page, data }) => {
  const { organisation } = data;
  await prisma.organisation.update({ where: { id: organisation.id }, data: { pickupPolicy: "EngSoc office, Level 2. Tuesdays 12 to 2 pm." } });
  const now = new Date();
  const product = await prisma.merchandiseProduct.create({ data: { organisationId: organisation.id, name: "Enamel pin", status: "published", publishedAt: now, firstPublishedAt: now } });
  const pin = await prisma.merchandiseVariant.create({ data: { productId: product.id, organisationId: organisation.id, sku: `E2E-PIN-${Date.now()}`, priceAmount: 600, remaining: 10 } });
  const order = await prisma.$transaction((tx) => createCommerceOrder(tx, {
    organisationId: organisation.id, kind: "merchandise", buyer: { userId: data.member.id }, buyerEmail: data.member.email, buyerName: "Sam Lee", paymentKind: "stripe", feeAmount: 120,
    lines: [{ quantity: 2, unitAmount: 600, name: "Enamel pin", merchandiseVariantId: pin.id }], source: "checkout"
  }));
  await prisma.commerceOrder.update({ where: { id: order.id }, data: { status: "paid", paidAt: now, fulfilledAt: now, pickupStatus: "pending" } });
  const reference = order.id.slice(-6).toUpperCase();

  await login(page, data.owner.email, "/dashboard/merchandise");
  await page.getByRole("link", { name: "Pickups · 1 to prepare" }).click();
  await expect(page.getByRole("link", { name: "To prepare 1" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("2 × Enamel pin").first()).toBeVisible();
  await shoot(page, "pickups");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: `Mark ready for order ${reference}` }).first().click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: `Mark order ${reference} ready to collect?` })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Mark ready" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Order ${reference} is on the Ready tab. Sam Lee was emailed.` })).toBeVisible();
  await page.getByRole("link", { name: "Ready to collect 1" }).click();
  await expect(page.getByRole("columnheader", { name: "Ready since" })).toBeVisible();
  await page.getByRole("button", { name: `Mark collected for order ${reference}` }).first().click();
  await expect(page.getByRole("dialog")).toContainText("For Sam Lee.");
  await page.getByRole("dialog").getByRole("button", { name: "Mark collected" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Order ${reference} was handed over by` })).toBeVisible();
  await page.getByRole("link", { name: "Collected 1" }).click();
  await expect(page.getByRole("cell", { name: / by / })).toBeVisible();
  await shoot(page, "pickups-collected");

  await page.context().clearCookies();
  await login(page, data.member.email, `/merchandise/orders/${order.id}`);
  await expect(page.getByRole("heading", { name: "Collected" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Pickup progress" })).toContainText("Collected");
  await shoot(page, "order-collected");

  // T29a: Purchases has a Merchandise tab, with payment and pickup as separate badges, that opens the order.
  await page.goto("/purchases");
  await page.getByRole("link", { name: /^Merchandise/ }).click();
  await expect(page).toHaveURL(/family=merchandise/);
  const row = page.getByRole("region", { name: "Merchandise purchases" });
  await expect(row.getByText(`Order ${reference}`).first()).toBeVisible();
  await expect(row.getByText("Collected").first()).toBeVisible();
  await shoot(page, "purchases-merchandise");
  await row.getByRole("link", { name: "2 × Enamel pin" }).first().click();
  await expect(page.getByRole("heading", { name: "Collected" })).toBeVisible();
});

// T28b: the owner opens an order from Pickups, records a return that restocks, cancels a free order, and the buyer sees it cancelled.
// PAY-003: what Stripe reported that Thunderstrux didn't do, on the staff order page.
test("a disputed order can't be handed over, and a partial refund made in Stripe is marked reviewed", async ({ page, data }) => {
  const { organisation } = data;
  const now = new Date();
  const product = await prisma.merchandiseProduct.create({ data: { organisationId: organisation.id, name: "Club scarf", status: "published", publishedAt: now, firstPublishedAt: now } });
  const scarf = await prisma.merchandiseVariant.create({ data: { productId: product.id, organisationId: organisation.id, sku: `E2E-SCARF-${Date.now()}`, priceAmount: 2500, remaining: 10 } });
  const paidOrder = async () => {
    const order = await prisma.$transaction((tx) => createCommerceOrder(tx, {
      organisationId: organisation.id, kind: "merchandise", buyer: { userId: data.member.id }, buyerEmail: data.member.email, buyerName: "Sam Lee", paymentKind: "stripe", feeAmount: 250,
      lines: [{ quantity: 1, unitAmount: 2500, name: "Club scarf", merchandiseVariantId: scarf.id }], source: "checkout"
    }));
    return prisma.commerceOrder.update({ where: { id: order.id }, data: { status: "paid", paidAt: now, fulfilledAt: now, pickupStatus: "pending" } });
  };
  const disputed = await paidOrder();
  await prisma.commerceOrder.update({ where: { id: disputed.id }, data: { disputeStatus: "open" } });
  await prisma.purchaseDispute.create({ data: { commerceOrderId: disputed.id, organisationId: organisation.id, stripeDisputeId: `dp_e2e_${disputed.id}`, stripeChargeId: `ch_e2e_${disputed.id}`, amount: 2500, currency: "aud", providerStatus: "needs_response", evidenceDueBy: new Date(Date.now() + 7 * 86_400_000) } });
  const partly = await paidOrder();
  await prisma.commerceOrder.update({ where: { id: partly.id }, data: { externalRefundedAmount: 1000 } });

  await login(page, data.owner.email, `/dashboard/merchandise/orders/${disputed.id}`);
  await expect(page.getByText("The buyer has disputed this payment")).toBeVisible();
  await expect(page.getByText("refunds are paused and the order can't be handed over")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the dispute in Stripe" })).toHaveAttribute("href", `https://dashboard.stripe.com/test/disputes/dp_e2e_${disputed.id}`);
  await expect(page.getByRole("button", { name: /^Mark (ready|collected)/ })).toHaveCount(0);
  await shoot(page, "order-disputed");
  await page.goto("/dashboard/merchandise/pickups?stage=review");
  await expect(page.getByText("1 × Club scarf").first()).toBeVisible();

  await page.goto(`/dashboard/merchandise/orders/${partly.id}`);
  await expect(page.getByText("Partly refunded in Stripe: needs review")).toBeVisible();
  await shoot(page, "order-partly-refunded");
  await expect(page.getByText("$10.00 in Stripe")).toBeVisible();
  await page.getByRole("button", { name: "Mark as reviewed" }).click();
  await expect(page.getByText("Partly refunded in Stripe", { exact: true })).toBeVisible();
  expect((await prisma.commerceOrder.findUniqueOrThrow({ where: { id: partly.id } })).externalRefundReviewedAt).not.toBeNull();
});

test("an owner records a return and cancels a free order from the order page, and the buyer sees the cancellation", async ({ page, data }) => {
  const { organisation } = data;
  await prisma.organisation.update({ where: { id: organisation.id }, data: { pickupPolicy: "EngSoc office, Level 2.", stripeAccountId: "acct_e2e_after_sale", stripeChargesEnabled: true } });
  const now = new Date();
  const product = await prisma.merchandiseProduct.create({ data: { organisationId: organisation.id, name: "Lanyard", status: "published", publishedAt: now, firstPublishedAt: now } });
  const lanyard = await prisma.merchandiseVariant.create({ data: { productId: product.id, organisationId: organisation.id, sku: `E2E-LAN-${Date.now()}`, priceAmount: 500, remaining: 4 } });
  const seed = async (free: boolean, pickupStatus: "pending" | "collected") => {
    const order = await prisma.$transaction((tx) => createCommerceOrder(tx, {
      organisationId: organisation.id, kind: "merchandise", buyer: { userId: data.member.id }, buyerEmail: data.member.email, buyerName: "Sam Lee", paymentKind: free ? "free" : "stripe", feeAmount: free ? 0 : 50,
      lines: [{ quantity: 1, unitAmount: free ? 0 : 500, name: "Lanyard", merchandiseVariantId: lanyard.id }], source: "checkout"
    }));
    await prisma.commerceOrder.update({ where: { id: order.id }, data: { status: "paid", paidAt: now, fulfilledAt: now, pickupStatus, ...(free ? {} : { stripeSessionId: `cs_e2e_${order.id}` }) } });
    return { id: order.id, reference: order.id.slice(-6).toUpperCase() };
  };
  const collected = await seed(false, "collected");
  const free = await seed(true, "pending");

  await login(page, data.owner.email, "/dashboard/merchandise/pickups?stage=collected");
  await page.getByRole("link", { name: `Open order ${collected.reference}` }).click();
  await expect(page.getByRole("heading", { name: `Order ${collected.reference}`, level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refund whole order" })).toBeVisible();
  await page.getByRole("button", { name: "Record a return" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: `Record a return for order ${collected.reference}` })).toBeVisible();
  await dialog.getByLabel("Reason").fill("Clip broken, swapped for a new one.");
  await dialog.getByLabel(/Put it back in stock/).check();
  await dialog.getByRole("button", { name: "Record return" }).click();
  await expect(page.getByText(/came back on .* Restocked/)).toBeVisible();
  expect((await prisma.merchandiseVariant.findUniqueOrThrow({ where: { id: lanyard.id } })).remaining).toBe(5);
  await shoot(page, "staff-order");

  await page.goto(`/dashboard/merchandise/orders/${free.id}`);
  await page.getByRole("button", { name: "Cancel free order" }).click();
  await page.getByRole("dialog").getByLabel("Reason").fill("Ordered twice by mistake.");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel order" }).click();
  await expect(page.getByText("This free order was cancelled")).toBeVisible();

  // T29b: Orders has a Merchandise tab with payment and pickup, opening the staff order page.
  await page.goto("/dashboard/orders");
  await page.getByRole("navigation", { name: "Order types" }).getByRole("link", { name: "Merchandise" }).click();
  await expect(page).toHaveURL(/family=merchandise/);
  const orders = page.getByRole("table", { name: "Merchandise orders" });
  await expect(orders.getByText(`Order ${collected.reference}`)).toBeVisible();
  await expect(orders.getByText("Cancelled")).toBeVisible();
  await shoot(page, "orders-merchandise");
  await page.getByRole("link", { name: "Payment review" }).click();
  await expect(page.getByText("No payment review merchandise orders")).toBeVisible();

  await page.context().clearCookies();
  await login(page, data.member.email, `/merchandise/orders/${free.id}`);
  await expect(page.getByRole("heading", { name: "Cancelled" })).toBeVisible();
  await expect(page.getByText("Not collected, nothing to pick up")).toBeVisible();
});
