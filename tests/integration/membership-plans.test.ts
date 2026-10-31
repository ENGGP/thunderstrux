import { describe, expect, test } from "vitest";
import { GET as listRoute, POST as createRoute } from "@/app/api/orgs/[orgSlug]/memberships/route";
import { PATCH as updateRoute } from "@/app/api/orgs/[orgSlug]/memberships/[planId]/route";
import { POST as publishRoute } from "@/app/api/orgs/[orgSlug]/memberships/[planId]/publish/route";
import { POST as archiveRoute } from "@/app/api/orgs/[orgSlug]/memberships/[planId]/archive/route";
import { defaultTerm } from "@/components/memberships/plan-form";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { membershipOffers } from "@/lib/memberships/offers";
import { daysFromTerm, listPlans, readPlan } from "@/lib/memberships/plans";
import { clearMockSession, setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { createMember, createOrganisationAccount, createOrganisationStaff } from "@/tests/helpers/test-data";

const base = "http://localhost:3000/api/orgs";
const year = new Date().getUTCFullYear() + 1;
const fullYear = { name: `${year} membership`, description: "A full year of socials.", priceAmount: 2500, firstDay: `${year}-01-01`, lastDay: `${year}-12-31`, entitlements: ["members_only_events", "member_prices"] };
const semester1 = { ...fullYear, name: `Semester 1 ${year}`, priceAmount: 0, lastDay: `${year}-06-30` };
const semester2 = { ...fullYear, name: `Semester 2 ${year}`, priceAmount: 0, firstDay: `${year}-07-01` };

async function society({ stripeReady = false, timeZone = "Australia/Brisbane" } = {}) {
  const account = await createOrganisationAccount({ stripeReady });
  await prisma.organisation.update({ where: { id: account.organisation.id }, data: { timeZone } });
  return account;
}
const signIn = (user: { id: string; email: string }, accountRole: "member" | "organisation" = "organisation") =>
  setMockSession({ userId: user.id, email: user.email, accountRole });

async function call(response: Promise<Response>) {
  const result = await response;
  return { status: result.status, body: await parseJsonResponse(result) };
}
const create = (slug: string, body: unknown) => call(createRoute(jsonRequest(`${base}/${slug}/memberships`, body), routeContext({ orgSlug: slug })));
const update = (slug: string, planId: string, body: unknown) =>
  call(updateRoute(jsonRequest(`${base}/${slug}/memberships/${planId}`, body, { method: "PATCH" }), routeContext({ orgSlug: slug, planId })));
const publish = (slug: string, planId: string, expectedVersion: number) =>
  call(publishRoute(jsonRequest(`${base}/${slug}/memberships/${planId}/publish`, { expectedVersion }), routeContext({ orgSlug: slug, planId })));
const archive = (slug: string, planId: string, expectedVersion: number) =>
  call(archiveRoute(jsonRequest(`${base}/${slug}/memberships/${planId}/archive`, { expectedVersion }), routeContext({ orgSlug: slug, planId })));

// A membership order line naming the plan: the plan has sold.
async function sell(organisationId: string, plan: { id: string; name: string; startsAt: string | Date; endsAt: string | Date }) {
  const buyer = await createMember();
  return prisma.$transaction((tx) =>
    createCommerceOrder(tx, {
      organisationId, kind: "membership", buyer: { userId: buyer.id }, buyerEmail: buyer.email, paymentKind: "free", source: "checkout",
      lines: [{ quantity: 1, unitAmount: 0, name: plan.name, termStartsAt: new Date(plan.startsAt), termEndsAt: new Date(plan.endsAt), membershipProductId: plan.id }]
    })
  );
}

describe("membership plans", () => {
  test("after a society changes zone, saving a plan keeps its term, sold or not; new days use the new zone", async () => {
    const { user, organisation } = await society({ timeZone: "Australia/Sydney" });
    signIn(user);
    const sold = (await create(organisation.slug, semester1)).body.plan;
    const unsold = (await create(organisation.slug, semester2)).body.plan;
    await sell(organisation.id, sold);
    await prisma.organisation.update({ where: { id: organisation.id }, data: { timeZone: "Australia/Perth" } });

    // What the form submits: the days it shows, read in the new zone.
    const save = async (planId: string, change: Record<string, unknown>) => {
      const { plan } = (await readPlan(organisation.id, planId))!;
      return update(organisation.slug, planId, { name: plan.name, description: plan.description, priceAmount: plan.priceAmount, firstDay: plan.firstDay, lastDay: plan.lastDay, entitlements: plan.entitlements, expectedVersion: plan.version, ...change });
    };
    const edited = await save(sold.id, { description: "New words." });
    expect(edited.status).toBe(200);
    expect(edited.body.plan).toMatchObject({ description: "New words.", startsAt: sold.startsAt, endsAt: sold.endsAt });
    expect((await save(unsold.id, { description: "New words." })).body.plan).toMatchObject({ startsAt: unsold.startsAt, endsAt: unsold.endsAt });

    // Real date changes still act: a sold plan refuses them, an unsold one takes them in the new zone.
    expect((await save(sold.id, { lastDay: `${year}-06-29` })).status).toBe(409);
    const moved = await save(unsold.id, { lastDay: `${year}-12-30` });
    expect(moved.status).toBe(200);
    expect(moved.body.plan.endsAt).toBe(new Date(`${year}-12-30T16:00:00.000Z`).toISOString());
  });

  test("a new plan opens on the soonest term that hasn't started, never one that is mostly over", () => {
    expect(defaultTerm(["2026", "2027", "2028"], "2026-10-25")).toEqual({ preset: "year", year: "2027" });
    expect(defaultTerm(["2026", "2027", "2028"], "2026-02-10")).toEqual({ preset: "semester2", year: "2026" });
    expect(defaultTerm(["2026", "2027"], "2026-01-01")).toEqual({ preset: "year", year: "2026" });
  });

  test("a draft's days become a term from the first midnight to the midnight after the last day, in the society's zone, with daylight saving", async () => {
    const { user, organisation } = await society({ timeZone: "Australia/Sydney" });
    signIn(user);
    const created = await create(organisation.slug, semester1);
    expect(created.status).toBe(201);
    // 1 Jan is daylight time (UTC+11); the day after 30 Jun is standard time (UTC+10).
    expect(created.body.plan).toMatchObject({
      status: "draft", version: 1, priceAmount: 0,
      startsAt: `${year - 1}-12-31T13:00:00.000Z`, endsAt: `${year}-06-30T14:00:00.000Z`,
      entitlements: ["member_prices", "members_only_events"]
    });
    expect(daysFromTerm(new Date(created.body.plan.startsAt), new Date(created.body.plan.endsAt), "Australia/Sydney")).toEqual({ firstDay: semester1.firstDay, lastDay: semester1.lastDay });
    expect(await prisma.auditLog.findFirst({ where: { targetId: created.body.plan.id }, select: { action: true, actorUserId: true } })).toEqual({ action: "membership_plan.created", actorUserId: user.id });
  });

  test("invalid terms, prices, dates and fields are refused before anything is written", async () => {
    const { user, organisation } = await society();
    signIn(user);
    const refusals: Array<[Record<string, unknown>, string]> = [
      [{ ...fullYear, lastDay: `${year}-01-01`, firstDay: `${year}-02-01` }, "lastDay"],
      [{ ...fullYear, firstDay: "2001-01-01", lastDay: "2001-12-31" }, "lastDay"],
      [{ ...fullYear, firstDay: `${year}-02-30` }, "firstDay"],
      [{ ...fullYear, priceAmount: -1 }, "priceAmount"],
      [{ ...fullYear, priceAmount: 12.5 }, "priceAmount"],
      // Stripe refuses an AUD card payment under $0.50.
      [{ ...fullYear, priceAmount: 49 }, "priceAmount"],
      [{ ...fullYear, name: "  " }, "name"],
      [{ ...fullYear, entitlements: ["lifetime_pass"] }, "entitlements"],
      [{ ...fullYear, organisationId: "other" }, ""]
    ];
    for (const [body, field] of refusals) {
      const result = await create(organisation.slug, body);
      expect(result.status, JSON.stringify(body)).toBe(400);
      if (field) expect(result.body.error.details.map((detail: { path: string[] }) => detail.path[0])).toContain(field);
    }
    expect(await prisma.membershipProduct.count()).toBe(0);
  });

  test("only live staff with memberships:manage change a society's plans; another society's plan is a 404", async () => {
    const { user, organisation } = await society();
    signIn(user);
    const plan = (await create(organisation.slug, fullYear)).body.plan;

    clearMockSession();
    expect((await create(organisation.slug, fullYear)).status).toBe(401);
    const member = await createMember();
    signIn(member, "member");
    expect((await call(listRoute(jsonRequest(`${base}/${organisation.slug}/memberships`), routeContext({ orgSlug: organisation.slug })))).status).toBe(404);
    const eventManager = await createMember();
    await createOrganisationStaff({ organisationId: organisation.id, userId: eventManager.id, role: "event_manager" });
    signIn(eventManager, "member");
    // Staff of this society without the permission are told so, as on the other society routes.
    expect((await update(organisation.slug, plan.id, { ...fullYear, expectedVersion: 1 })).status).toBe(403);

    const other = await society();
    signIn(other.user);
    // Through their own slug the foreign plan doesn't exist; through ours they have no access.
    expect((await update(other.organisation.slug, plan.id, { ...fullYear, name: "Taken", expectedVersion: 1 })).status).toBe(404);
    expect((await publish(other.organisation.slug, plan.id, 1)).status).toBe(404);
    expect((await archive(organisation.slug, plan.id, 1)).status).toBe(404);
    expect(await prisma.membershipProduct.findUniqueOrThrow({ where: { id: plan.id } })).toMatchObject({ name: fullYear.name, status: "draft", version: 1 });
  });

  test("publishing checks payments for paid plans, refuses overlap, allows back-to-back terms and repeats safely", async () => {
    const { user, organisation } = await society();
    signIn(user);
    const paid = (await create(organisation.slug, fullYear)).body.plan;
    const refused = await publish(organisation.slug, paid.id, 1);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details).toEqual([expect.objectContaining({ reason: "payments_unavailable" })]);

    const first = (await create(organisation.slug, semester1)).body.plan;
    const second = (await create(organisation.slug, semester2)).body.plan;
    expect((await publish(organisation.slug, first.id, 1)).body.plan).toMatchObject({ status: "published", version: 2 });
    // [start, end): Semester 2 starts at the instant Semester 1 ends.
    expect((await publish(organisation.slug, second.id, 1)).status).toBe(200);
    // Publishing again, even with an old version, changes nothing.
    expect((await publish(organisation.slug, first.id, 1)).body.plan).toMatchObject({ status: "published", version: 2 });

    await prisma.organisation.update({ where: { id: organisation.id }, data: { stripeAccountId: "acct_ready", stripeChargesEnabled: true } });
    const overlap = await publish(organisation.slug, paid.id, 1);
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.details[0]).toMatchObject({ reason: "overlap", path: ["firstDay"] });
    expect(overlap.body.error.message).toContain(`Semester 1 ${year}`);
    expect((await readPlan(organisation.id, paid.id))?.blockers.map((blocker) => blocker.code)).toEqual(["overlap"]);

    // A published plan can't be moved onto another.
    const moved = await update(organisation.slug, second.id, { ...semester2, firstDay: `${year}-06-01`, expectedVersion: 2 });
    expect(moved.status).toBe(409);
    expect((await prisma.membershipProduct.findUniqueOrThrow({ where: { id: second.id } })).version).toBe(2);
  });

  test("two overlapping drafts published at once: exactly one goes on sale", async () => {
    const { user, organisation } = await society();
    signIn(user);
    const a = (await create(organisation.slug, { ...semester1, name: "A" })).body.plan;
    const b = (await create(organisation.slug, { ...semester1, name: "B" })).body.plan;
    const results = await Promise.all([publish(organisation.slug, a.id, 1), publish(organisation.slug, b.id, 1)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await prisma.membershipProduct.count({ where: { organisationId: organisation.id, status: "published" } })).toBe(1);
  });

  test("an edit needs the current version; a sold plan keeps its name, term, price and unlocks, even against direct writes", async () => {
    const { user, organisation } = await society();
    signIn(user);
    const plan = (await create(organisation.slug, semester1)).body.plan;
    expect((await update(organisation.slug, plan.id, { ...semester1, priceAmount: 500, expectedVersion: 1 })).body.plan).toMatchObject({ priceAmount: 500, version: 2 });
    expect((await update(organisation.slug, plan.id, { ...semester1, expectedVersion: 1 })).status).toBe(409);
    await publish(organisation.slug, plan.id, 2).then((result) => expect(result.status).toBe(409)); // paid, no payments
    await update(organisation.slug, plan.id, { ...semester1, expectedVersion: 2 });
    await publish(organisation.slug, plan.id, 3);

    await sell(organisation.id, await prisma.membershipProduct.findUniqueOrThrow({ where: { id: plan.id } }));
    const locked = await update(organisation.slug, plan.id, { ...semester1, priceAmount: 300, expectedVersion: 4 });
    expect(locked.status).toBe(409);
    expect(locked.body.error.message).toMatch(/locked/);
    expect((await update(organisation.slug, plan.id, { ...semester1, name: "Renamed", expectedVersion: 4 })).status).toBe(409);
    expect((await update(organisation.slug, plan.id, { ...semester1, description: "Now with a BBQ.", expectedVersion: 4 })).body.plan).toMatchObject({ description: "Now with a BBQ.", version: 5 });
    await expect(prisma.membershipProduct.update({ where: { id: plan.id }, data: { priceAmount: 1 } })).rejects.toThrow();
    await expect(prisma.membershipProduct.update({ where: { id: plan.id }, data: { endsAt: new Date(Date.now() + 1e9) } })).rejects.toThrow();
    expect((await readPlan(organisation.id, plan.id))?.sold).toBe(true);
  });

  test("archive is one way: the plan stops selling, can't change or come back, and its history stays", async () => {
    const { user, organisation } = await society();
    signIn(user);
    const plan = (await create(organisation.slug, semester1)).body.plan;
    await publish(organisation.slug, plan.id, 1);
    await sell(organisation.id, plan);
    expect((await archive(organisation.slug, plan.id, 2)).body.plan).toMatchObject({ status: "archived", version: 3 });
    expect((await archive(organisation.slug, plan.id, 1)).status).toBe(200);
    expect((await publish(organisation.slug, plan.id, 3)).status).toBe(409);
    expect((await update(organisation.slug, plan.id, { ...semester1, description: "x", expectedVersion: 3 })).status).toBe(409);
    expect((await membershipOffers(organisation.id, null)).offers).toEqual([]);
    expect(await prisma.commerceOrderLine.count({ where: { membershipProductId: plan.id } })).toBe(1);
    expect((await prisma.auditLog.findMany({ where: { targetId: plan.id }, orderBy: { createdAt: "asc" }, select: { action: true } })).map((row) => row.action))
      .toEqual(["membership_plan.created", "membership_plan.published", "membership_plan.archived"]);
  });

  test("the public list holds only published plans still to end, without staff facts; staff see every plan with its standing", async () => {
    const { user, organisation } = await society();
    signIn(user);
    const draft = (await create(organisation.slug, { ...semester1, name: "Draft" })).body.plan;
    const live = (await create(organisation.slug, semester2)).body.plan;
    await publish(organisation.slug, live.id, 1);
    const ended = (await create(organisation.slug, { ...semester1, name: "Old" })).body.plan;
    await publish(organisation.slug, ended.id, 1);
    // Its term passes (no sale, so the dates may move).
    await prisma.membershipProduct.update({ where: { id: ended.id }, data: { startsAt: new Date("2020-01-01"), endsAt: new Date("2020-07-01") } });
    const other = await society();
    signIn(other.user);
    await create(other.organisation.slug, semester2).then(async (result) => publish(other.organisation.slug, result.body.plan.id, 1));

    const { offers: visible } = await membershipOffers(organisation.id, null);
    expect(visible.map((plan) => plan.id)).toEqual([live.id]);
    expect(Object.keys(visible[0]).sort()).toEqual(["description", "endsAt", "entitlements", "id", "name", "priceAmount", "startsAt", "state"]);

    const staff = await listPlans(organisation.id);
    expect(Object.fromEntries(staff.plans.map((plan) => [plan.id, plan.standing]))).toEqual({ [draft.id]: "draft", [live.id]: "published", [ended.id]: "ended" });
  });

  test("the database keeps a plan in its society: a line of another society can't name it", async () => {
    const { user, organisation } = await society();
    signIn(user);
    const plan = (await create(organisation.slug, semester1)).body.plan;
    const other = await society();
    await expect(sell(other.organisation.id, plan)).rejects.toThrow();
    await expect(prisma.membershipProduct.update({ where: { id: plan.id }, data: { organisationId: other.organisation.id } })).rejects.toThrow();
  });
});
