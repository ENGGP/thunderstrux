import { createCommerceOrder } from "@/lib/commerce/orders";
import { createMembershipGrant } from "@/tests/helpers/test-data";
import { test, expect, login, prisma, selectStaffContext } from "./fixtures";

// T22: an owner drafts, fixes, publishes and archives a membership plan; staff
// without memberships:manage never see it. The society has no Stripe, so a
// paid plan waits on payments and a free one publishes.
test("an owner drafts a plan, sees the publish check, publishes it free and archives it", async ({ page, data }) => {
  await login(page, data.owner.email, "/dashboard/memberships");
  await expect(page.getByRole("heading", { name: "Memberships", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No membership plans yet" })).toBeVisible();

  await page.getByRole("link", { name: "New plan" }).first().click();
  await expect(page.getByRole("heading", { name: "New membership plan", level: 1 })).toBeVisible();
  const year = String(new Date().getFullYear() + 1);
  await page.getByLabel("Year", { exact: true }).selectOption(year);
  await page.getByRole("radio", { name: "Semester 1" }).check();
  await expect(page.getByLabel("First day", { exact: true })).toHaveValue(`1 Jan ${year}`);
  await expect(page.getByLabel("Last day", { exact: true })).toHaveValue(`30 Jun ${year}`);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(`Semester 1 ${year}`);
  await page.getByLabel("Price", { exact: true }).fill("25");
  await expect(page.getByText("your society receives $23.17")).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();

  await expect(page.getByRole("heading", { name: `Semester 1 ${year}`, level: 1 })).toBeVisible();
  await expect(page.getByText("Set up payments to sell a paid plan.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish plan" })).toBeDisabled();

  await page.getByLabel("Price", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Plan saved.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish plan" })).toBeEnabled();
  await page.getByRole("button", { name: "Publish plan" }).click();
  await expect(page.getByRole("heading", { name: "On sale" })).toBeVisible();
  await expect(page.getByText("Published", { exact: true })).toBeVisible();

  for (const [path, name] of [["/dashboard/memberships", "list"], [page.url().replace("http://localhost:3100", ""), "plan"]] as const) {
    await page.goto(path);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/memberships-${name}-${width}.png`, fullPage: true });
    }
  }

  await page.getByRole("button", { name: "Archive plan" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("An archived plan can't go back on sale.")).toBeVisible();
  await dialog.getByRole("button", { name: "Archive plan" }).click();
  await expect(page.getByText("This plan no longer sells")).toBeVisible();
  await page.goto("/dashboard/memberships");
  await expect(page.getByText("Archived", { exact: true }).first()).toBeVisible();
});

test("staff without memberships:manage see no Memberships item and get not found", async ({ page, data }) => {
  await login(page, data.manager.email, "/dashboard");
  await selectStaffContext(page, data.organisation.id);
  await expect(page.getByRole("navigation", { name: "Organisation navigation" }).getByRole("link", { name: "Events" }).first()).toBeAttached();
  await expect(page.getByRole("link", { name: "Memberships" })).toHaveCount(0);
  const response = await page.goto("/dashboard/memberships");
  expect(response?.status()).toBe(404);
});

test("a member buys a free membership through checkout and the owner finds them on the Members tab", async ({ page, data }) => {
  const plan = await prisma.membershipProduct.create({
    data: {
      organisationId: data.organisation.id, name: "Semester 2 free", priceAmount: 0, entitlements: ["members_only_events"], status: "published", publishedAt: new Date(),
      startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 100 * 86_400_000)
    }
  });
  await prisma.user.update({ where: { id: data.member.id }, data: { firstName: "Robin", lastName: "Member" } });
  await login(page, data.member.email, "/dashboard");
  const { token } = await (await page.request.get("/api/security/csrf")).json();
  const bought = await page.request.post("/api/payments/checkout/membership", {
    headers: { Origin: "http://localhost:3100", "x-thunderstrux-csrf-token": token },
    data: { organisationId: data.organisation.id, selection: { planId: plan.id }, expectedTotal: 0, idempotencyKey: "e2e-membership-free-0001" }
  });
  expect(bought.status()).toBe(200);
  expect((await bought.json()).kind).toBe("fulfilled");
  await page.context().clearCookies();

  await login(page, data.owner.email, "/dashboard/memberships/members");
  await expect(page.getByRole("link", { name: "Members", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Active 1" })).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/memberships-roster-${width}.png`, fullPage: true });
  }
  await page.getByRole("link", { name: "Robin Member" }).first().click();
  await expect(page.getByRole("heading", { name: "Robin Member", level: 1 })).toBeVisible();
  await expect(page.getByText("Members-only events", { exact: true })).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/memberships-member-${width}.png`, fullPage: true });
  }

  // Ending it early: the free membership is cancelled through the dialog.
  await page.getByRole("button", { name: "Cancel free membership" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Nothing was charged, so there's nothing to refund.")).toBeVisible();
  await dialog.getByLabel("Reason").fill("Signed up twice by mistake.");
  await page.screenshot({ path: "test-results/memberships-cancel-dialog-1280.png" });
  await dialog.getByRole("button", { name: "Cancel membership" }).click();
  await expect(page.getByText("Free membership cancelled").first()).toBeVisible();
  await expect(page.getByText("Revoked", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel free membership" })).toHaveCount(0);
});

test("a paid membership offers a refund that names the amount and asks for the order reference", async ({ page, data }) => {
  const term = { startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 100 * 86_400_000) };
  await prisma.organisation.update({ where: { id: data.organisation.id }, data: { stripeAccountId: "acct_e2e_membership", stripeChargesEnabled: true } });
  const plan = await prisma.membershipProduct.create({ data: { organisationId: data.organisation.id, name: "Semester 2 paid", priceAmount: 1500, ...term, entitlements: ["member_prices"], status: "published", publishedAt: new Date() } });
  await prisma.user.update({ where: { id: data.member.id }, data: { firstName: "Sam", lastName: "Paid" } });
  const order = await prisma.$transaction((tx) => createCommerceOrder(tx, {
    organisationId: data.organisation.id, kind: "membership", buyer: { userId: data.member.id }, buyerEmail: data.member.email, paymentKind: "stripe", feeAmount: 150, source: "checkout",
    lines: [{ quantity: 1, unitAmount: 1500, name: plan.name, termStartsAt: term.startsAt, termEndsAt: term.endsAt, membershipProductId: plan.id }]
  }));
  await prisma.commerceOrder.update({ where: { id: order.id }, data: { status: "paid", paidAt: new Date(), fulfilledAt: new Date(), stripeSessionId: "cs_e2e_membership_paid" } });
  const line = await prisma.commerceOrderLine.findFirstOrThrow({ where: { orderId: order.id } });
  const grant = await prisma.membershipGrant.create({ data: { userId: data.member.id, organisationId: data.organisation.id, membershipProductId: plan.id, commerceOrderLineId: line.id, ...term, entitlements: plan.entitlements, entitlementVersion: 1 } });

  await login(page, data.owner.email, `/dashboard/memberships/members/${grant.id}`);
  await expect(page.getByRole("button", { name: "Revoke membership" })).toBeVisible();
  await page.getByRole("button", { name: "Refund membership" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Refund $15.00 to Sam Paid?" })).toBeVisible();
  await expect(dialog.getByLabel(`Type ${order.id.slice(-6).toUpperCase()} to confirm`)).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `test-results/memberships-refund-dialog-${width}.png` });
  }
  await dialog.getByRole("button", { name: "Keep membership" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await prisma.refundRequest.count({ where: { commerceOrderId: order.id } })).toBe(0);
});

test("a member finds a membership on the society page, gets it free through the review and sees it in My memberships; a join alone is not a membership", async ({ page, data }) => {
  const plan = await prisma.membershipProduct.create({
    data: {
      organisationId: data.organisation.id, name: "Semester 2 open", priceAmount: 0, entitlements: ["members_only_events"], status: "published", publishedAt: new Date(),
      startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 100 * 86_400_000)
    }
  });
  const memberships = `/societies/${data.organisation.slug}/memberships`;

  // Signed out: the offer asks for a member account.
  await page.goto(memberships);
  await expect(page.getByRole("heading", { name: "Semester 2 open" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to buy membership" })).toBeVisible();

  // A member who has only joined sees Joined, no membership badge, and the offer.
  await prisma.organisationMember.create({ data: { userId: data.member.id, organisationId: data.organisation.id, role: "member" } });
  await login(page, data.member.email, memberships);
  await expect(page.getByText("Joined", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^Member until/)).toHaveCount(0);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/memberships-offers-${width}.png`, fullPage: true });
  }

  await page.getByRole("link", { name: "Get free membership" }).click();
  await expect(page.getByRole("heading", { name: "Confirm your membership", level: 1 })).toBeVisible();
  await expect(page.getByText("No automatic renewal")).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/memberships-review-${width}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "Confirm free membership" }).click();
  await expect(page.getByRole("heading", { name: "You're a member", level: 1 })).toBeVisible();
  await page.screenshot({ path: "test-results/memberships-confirmed-390.png", fullPage: true });

  await page.getByRole("link", { name: "View my memberships" }).click();
  await expect(page.getByRole("heading", { name: "My memberships", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Semester 2 open" })).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/memberships-mine-${width}.png`, fullPage: true });
  }

  // The society page now shows both badges, and the offer says it's held.
  await page.goto(memberships);
  await expect(page.getByText(/^Member until/)).toBeVisible();
  await expect(page.getByText(/You're a member until/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Get free membership" })).toHaveCount(0);
  // Its review page refuses the same dates again without charging.
  await page.goto(`${memberships}/${plan.id}/checkout`);
  await expect(page.getByText("You already have a membership for these dates")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm free membership" })).toHaveCount(0);
});

test("an event's member price shows to a member with member prices, and everyone else sees what members pay", async ({ page, data }) => {
  const term = { startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 100 * 86_400_000) };
  await prisma.organisation.update({ where: { id: data.organisation.id }, data: { stripeAccountId: "acct_e2e_member_price", stripeChargesEnabled: true } });
  await prisma.ticketType.update({ where: { id: data.ticket.id }, data: { price: 1500, memberPrice: 1000 } });
  const plan = await prisma.membershipProduct.create({ data: { organisationId: data.organisation.id, name: "Member price plan", priceAmount: 0, ...term, entitlements: ["member_prices"], status: "published", publishedAt: new Date() } });

  // Not a member yet: the standard price, with what members pay and where to become one.
  await login(page, data.member.email, `/events/${data.event.id}`);
  await expect(page.getByText(/Members pay \$10\.00/)).toBeVisible();
  await expect(page.getByRole("link", { name: "See memberships" })).toBeVisible();

  const order = await prisma.$transaction((tx) => createCommerceOrder(tx, {
    organisationId: data.organisation.id, kind: "membership", buyer: { userId: data.member.id }, buyerEmail: data.member.email, paymentKind: "free", source: "checkout",
    lines: [{ quantity: 1, unitAmount: 0, name: plan.name, termStartsAt: term.startsAt, termEndsAt: term.endsAt, membershipProductId: plan.id }]
  }));
  const line = await prisma.commerceOrderLine.findFirstOrThrow({ where: { orderId: order.id } });
  await prisma.membershipGrant.create({ data: { userId: data.member.id, organisationId: data.organisation.id, membershipProductId: plan.id, commerceOrderLineId: line.id, ...term, entitlements: ["member_prices"], entitlementVersion: 1 } });

  await page.reload();
  await expect(page.getByText(/Member price$/).first()).toBeVisible();
  await expect(page.getByText("Member price through your Member price plan membership.")).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/member-price-event-${width}.png`, fullPage: true });
  }
  // One ticket at the member price: more goes back to the box, which keeps the choice at 1 and says why.
  await page.goto(`/events/${data.event.id}/checkout?ticketTypeId=${data.ticket.id}&quantity=2`);
  await expect(page).toHaveURL(new RegExp(`/events/${data.event.id}\\?`));
  await expect(page.getByLabel("Quantity")).toHaveValue("1");
  await expect(page.getByText("1 at the member price")).toBeVisible();
  await page.goto(`/events/${data.event.id}/checkout?ticketTypeId=${data.ticket.id}&quantity=1`);
  await expect(page.getByText("(member price)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay A$10.00" })).toBeVisible();
});

// T24b2: the members-only gate's safety contract, checked on the full response.
test("a members-only event shows anyone without access a gate with nothing about the event, and members it is open to the full page", async ({ page, request, data }) => {
  const sentinel = `SENTINEL-${Date.now()}`;
  await prisma.event.update({ where: { id: data.event.id }, data: { visibility: "members_only", title: `${sentinel}-title`, description: `${sentinel}-description`, location: `${sentinel}-place` } });
  await prisma.ticketType.update({ where: { id: data.ticket.id }, data: { name: `${sentinel}-ticket` } });
  const path = `/events/${data.event.id}`;

  const signedOut = await request.get(path);
  expect(signedOut.status()).toBe(200);
  const html = await signedOut.text();
  expect(html).toContain("Members-only event");
  expect(html).not.toContain(sentinel);
  expect(signedOut.headers()["cache-control"]).toMatch(/private/);
  expect(signedOut.headers()["cache-control"]).toMatch(/no-store/);
  // A wrong id or a draft members-only event is the not-found page, never the
  // gate. (The page streams after its loading state, so the status stays 200.)
  const draft = await prisma.event.create({
    data: { organisationId: data.organisation.id, title: `${sentinel}-draft`, description: "Draft", location: "Hall", startTime: new Date(Date.now() + 86_400_000), endTime: new Date(Date.now() + 90_000_000), salesCloseAt: new Date(Date.now() + 86_400_000), visibility: "members_only" }
  });
  for (const id of ["no-such-event", draft.id]) {
    const missing = await (await request.get(`/events/${id}`)).text();
    expect(missing).toContain("This page could not be found.");
    expect(missing).not.toContain("Members-only event");
    expect(missing).not.toContain(sentinel);
  }

  // Signed in without a membership: the gate, its reason and no event details.
  await login(page, data.member.email, path);
  await expect(page.getByRole("heading", { name: "Members-only event", level: 1 })).toBeVisible();
  await expect(page.getByText("you don't have an active membership")).toBeVisible();
  await expect(page).toHaveTitle(`Members-only event · ${data.organisation.name} · Thunderstrux`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect(await page.content()).not.toContain(sentinel);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/members-only-gate-${width}.png`, fullPage: true });
  }

  await createMembershipGrant(data.organisation.id, data.member.id, data.member.email, { entitlements: ["members_only_events"] });
  await page.reload();
  await expect(page.getByRole("heading", { name: `${sentinel}-title`, level: 1 })).toBeVisible();
  await expect(page.getByText(`You can see this because your ${data.organisation.name} membership includes members-only events.`)).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/members-only-event-${width}.png`, fullPage: true });
  }
});
