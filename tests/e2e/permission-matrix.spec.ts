import type { Page } from "@playwright/test";
import { test, expect, prisma, login, selectStaffContext, createMember, createOrganisationAccount, createOrganisationStaff, type seed } from "./fixtures";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { hasOrganisationPermission, type OrganisationPermission, type OrganisationStaffRole } from "@/lib/permissions";
import { totpCode } from "@/lib/security/staff-mfa";
import { createMembershipGrant, createOrder } from "@/tests/helpers/test-data";

// T44b: the permission matrix, with staff MFA enforced (this spec runs in the
// campaign's MFA step) and two societies. Each staff role signs in, sets up
// its authenticator, and opens every dashboard page of its society: the page
// answers 200 exactly when the role holds the page's permission, and the same
// concealed 404 otherwise. Another society's owner, also MFA-verified, can't
// open any of this society's records. lib/permissions is the role map under test.

type Society = Awaited<ReturnType<typeof seed>>;

async function signInWithMfa(page: Page, email: string, organisationId: string) {
  await login(page, email, "/mfa");
  await page.goto("/mfa?callbackUrl=/dashboard");
  await page.getByLabel("Your password").fill("password123");
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  const secret = (await page.locator("code").textContent())!;
  await page.getByLabel("Authenticator code").fill(totpCode(secret, Math.floor(Date.now() / 30_000)));
  await page.getByRole("button", { name: "Confirm setup" }).click();
  await page.getByRole("button", { name: "I saved my codes" }).click();
  await expect(page).toHaveURL("http://localhost:3100/dashboard");
  await selectStaffContext(page, organisationId);
}

// One record of each kind the dashboard opens, so detail pages are in the matrix too.
async function records(data: Society) {
  const buyer = await createMember();
  const order = await createOrder({ organisationId: data.organisation.id, eventId: data.event.id, ticketTypeId: data.ticket.id, userId: buyer.id, status: "paid", paidAt: new Date(), unitPrice: 1200 });
  const grant = await createMembershipGrant(data.organisation.id, buyer.id, buyer.email);
  const product = await prisma.merchandiseProduct.create({ data: { organisationId: data.organisation.id, name: "Matrix Tote", status: "published", publishedAt: new Date(), firstPublishedAt: new Date() } });
  const variant = await prisma.merchandiseVariant.create({ data: { productId: product.id, organisationId: data.organisation.id, sku: `MATRIX-${Date.now()}`, priceAmount: 0, remaining: 5 } });
  const merch = await prisma.$transaction((tx) => createCommerceOrder(tx, {
    organisationId: data.organisation.id, kind: "merchandise", buyer: { userId: buyer.id }, buyerEmail: buyer.email, paymentKind: "free", source: "checkout",
    lines: [{ quantity: 1, unitAmount: 0, name: "Matrix Tote", merchandiseVariantId: variant.id }]
  }));
  await prisma.commerceOrder.update({ where: { id: merch.id }, data: { status: "paid", paidAt: new Date(), fulfilledAt: new Date() } });
  const event = data.event.id;
  // Each dashboard page and the permission its guard asks for (any of a list).
  return [
    ["/dashboard/events", "events:read"],
    ["/dashboard/events/new", "events:manage"],
    [`/dashboard/events/${event}`, "analytics:read"],
    [`/dashboard/events/${event}/edit`, "events:manage"],
    [`/dashboard/events/${event}/preview`, "events:manage"],
    [`/dashboard/events/${event}/tickets`, "tickets:check_in"],
    ["/dashboard/calendar", "events:read"],
    ["/dashboard/analytics", "analytics:read"],
    ["/dashboard/orders", "orders:read"],
    [`/dashboard/orders/${order.id}`, "orders:read"],
    ["/dashboard/notifications", "orders:email_resend"],
    ["/dashboard/memberships", "memberships:manage"],
    ["/dashboard/memberships/new", "memberships:manage"],
    [`/dashboard/memberships/${grant.membershipProductId}`, "memberships:manage"],
    ["/dashboard/memberships/members", "members:read"],
    [`/dashboard/memberships/members/${grant.id}`, ["members:read", "orders:read"]],
    ["/dashboard/merchandise", "merchandise:manage"],
    ["/dashboard/merchandise/new", "merchandise:manage"],
    [`/dashboard/merchandise/${product.id}`, "merchandise:manage"],
    ["/dashboard/merchandise/pickups", "merchandise:fulfil"],
    [`/dashboard/merchandise/orders/${merch.id}`, ["merchandise:fulfil", "orders:read"]],
    ["/dashboard/history", "audit:read"],
    ["/dashboard/settings", "stripe:manage"],
    ["/dashboard/settings/profile", "organisation:settings"],
    ["/dashboard/settings/staff", "staff:manage"]
  ] as Array<[string, OrganisationPermission | OrganisationPermission[]]>;
}

const roles: OrganisationStaffRole[] = ["owner", "admin", "event_manager", "finance_manager", "check_in_staff"];

for (const role of roles) {
  test(`${role.replace(/_/g, " ")}: every dashboard page opens exactly when the role allows it`, async ({ page, data }) => {
    test.setTimeout(150_000);
    const pages = await records(data);
    const person = await createMember();
    await createOrganisationStaff({ organisationId: data.organisation.id, userId: person.id, role });
    await signInWithMfa(page, person.email, data.organisation.id);
    const results: string[] = [];
    for (const [path, permission] of pages) {
      const allowed = (Array.isArray(permission) ? permission : [permission]).some((each) => hasOrganisationPermission(role, each));
      const response = await page.goto(path);
      results.push(`${response?.status()} ${path}`);
      expect(response?.status(), `${role} ${path}`).toBe(allowed ? 200 : 404);
    }
    // Every page answered: the matrix covers each role against every page.
    expect(results).toHaveLength(pages.length);
  });
}

test("another society's MFA-verified owner can't open this society's records or take its context", async ({ page, data }) => {
  test.setTimeout(150_000);
  const pages = await records(data);
  const other = await createOrganisationAccount();
  const outsider = await createMember();
  await createOrganisationStaff({ organisationId: other.organisation.id, userId: outsider.id, role: "owner" });
  await signInWithMfa(page, outsider.email, other.organisation.id);

  // Pages naming one of this society's records: concealed, never shown in the outsider's society.
  for (const [path] of pages.filter(([path]) => /\/c[a-z0-9]{20,}(\/|$)/.test(path))) {
    expect((await page.goto(path))?.status(), `outsider ${path}`).toBe(404);
  }
  // Its own society's lists stay open, and say nothing of the other.
  expect((await page.goto("/dashboard/events"))?.status()).toBe(200);
  await expect(page.getByText(data.event.title)).toHaveCount(0);

  // Choosing this society as context is refused, and its API reads stay closed.
  const { token } = await (await page.request.get("/api/security/csrf")).json();
  const context = await page.request.post("/api/me/context", { headers: { Origin: "http://localhost:3100", "x-thunderstrux-csrf-token": token }, data: { mode: "staff", organisationId: data.organisation.id } });
  expect(context.status()).toBeGreaterThanOrEqual(400);
  expect((await page.request.get(`/api/events?orgId=${data.organisation.id}`)).status()).toBeGreaterThanOrEqual(400);
  // The orders API always answers for the caller's own society: naming another returns none of its orders.
  const orders = await page.request.get(`/api/orders?orgId=${data.organisation.id}`);
  const listed = await orders.text();
  for (const order of await prisma.order.findMany({ where: { organisationId: data.organisation.id }, select: { id: true } })) expect(listed).not.toContain(order.id);
});
