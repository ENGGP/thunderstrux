import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { listEventOptions } from "@/lib/events/event-lifecycle";
import { listPlans } from "@/lib/memberships/plans";
import { listProducts } from "@/lib/merchandise/catalogue";
import { shopPageSize, shopProducts } from "@/lib/merchandise/shop";
import { discoverOrganisations, discoveryInput } from "@/lib/organisations/discovery";
import { getOrganisationOverview } from "@/lib/organisations/overview";
import { createEvent, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

// UI-025: the lists that used to stop silently at a cap now page both ways.
const day = 86_400_000;

describe("lists page both ways", () => {
  test("staff plans, 25 a page, newest term first", async () => {
    const { organisation } = await createOrganisationAccount();
    const start = Date.UTC(2027, 0, 1);
    await prisma.membershipProduct.createMany({
      data: Array.from({ length: 26 }, (_, index) => ({
        organisationId: organisation.id,
        name: `Plan ${index}`,
        priceAmount: 1000,
        startsAt: new Date(start + index * day),
        endsAt: new Date(start + index * day + 100 * day)
      }))
    });
    const first = await listPlans(organisation.id);
    expect(first.plans).toHaveLength(25);
    expect(first.plans[0].name).toBe("Plan 25");
    expect(first.previousCursor).toBeNull();
    const second = await listPlans(organisation.id, new Date(), { cursor: first.nextCursor!, direction: "next" });
    expect(second.plans.map((plan) => plan.name)).toEqual(["Plan 0"]);
    expect(second.nextCursor).toBeNull();
    const back = await listPlans(organisation.id, new Date(), { cursor: second.previousCursor!, direction: "prev" });
    expect(back.plans.map((plan) => plan.name)).toEqual(first.plans.map((plan) => plan.name));
  });

  test("staff products and the public shop", async () => {
    const { organisation } = await createOrganisationAccount();
    const start = Date.now() - 100 * day;
    for (let index = 0; index < 26; index += 1) {
      const at = new Date(start + index * day);
      await prisma.merchandiseProduct.create({
        data: { organisationId: organisation.id, name: `Tee ${index}`, status: "published", createdAt: at, publishedAt: at, firstPublishedAt: at }
      });
    }
    const staff = await listProducts(organisation.id);
    expect(staff.products).toHaveLength(25);
    expect(staff.products[0].name).toBe("Tee 25");
    expect((await listProducts(organisation.id, { cursor: staff.nextCursor!, direction: "next" })).products.map((row) => row.name)).toEqual(["Tee 0"]);

    const shop = await shopProducts(organisation.id);
    expect(shop.products).toHaveLength(shopPageSize);
    const rest = await shopProducts(organisation.id, { cursor: shop.nextCursor!, direction: "next" });
    expect(rest.products.map((row) => row.name)).toEqual(["Tee 1", "Tee 0"]);
    expect((await shopProducts(organisation.id, { cursor: rest.previousCursor!, direction: "prev" })).products.map((row) => row.name)).toEqual(shop.products.map((row) => row.name));
  });

  test("/societies goes back as well as forward", async () => {
    const name = unique("Paging society");
    const orgs = await Promise.all(Array.from({ length: 3 }, () => createOrganisationAccount({ name })));
    const ids = orgs.map((row) => row.organisation.id).sort();
    const read = (params: Record<string, string>) => discoverOrganisations(discoveryInput(new URLSearchParams({ q: name, limit: "1", ...params })));
    const first = await read({});
    const second = await read({ cursor: first.pageInfo.nextCursor! });
    const third = await read({ cursor: second.pageInfo.nextCursor! });
    expect([first, second, third].map((page) => page.organisations[0].id)).toEqual(ids);
    expect(third.pageInfo.nextCursor).toBeNull();
    const back = await read({ cursor: third.pageInfo.previousCursor!, direction: "prev" });
    expect(back.organisations[0].id).toBe(ids[1]);
    expect(back.pageInfo.nextCursor).not.toBeNull();
    const start = await read({ cursor: back.pageInfo.previousCursor!, direction: "prev" });
    expect(start.organisations[0].id).toBe(ids[0]);
    expect(start.pageInfo.previousCursor).toBeNull();
    expect(() => discoveryInput(new URLSearchParams({ direction: "sideways" }))).toThrow();
  });
});

describe("caps that stay say so", () => {
  test("an event filter keeps an older selected event", async () => {
    const { organisation } = await createOrganisationAccount();
    const old = await createEvent({ organisationId: organisation.id, title: "Very old" });
    await prisma.event.update({ where: { id: old.id }, data: { startTime: new Date(Date.now() - 900 * day), endTime: new Date(Date.now() - 899 * day), salesCloseAt: new Date(Date.now() - 900 * day) } });
    await prisma.event.createMany({
      data: Array.from({ length: 100 }, (_, index) => ({
        organisationId: organisation.id,
        title: `Newer ${index}`,
        description: "",
        location: "Room",
        startTime: new Date(Date.now() - index * day),
        endTime: new Date(Date.now() - index * day + 3600000),
        salesCloseAt: new Date(Date.now() - index * day)
      }))
    });
    expect((await listEventOptions(organisation.id)).some((option) => option.id === old.id)).toBe(false);
    expect((await listEventOptions(organisation.id, old.id)).at(-1)).toEqual({ id: old.id, title: "Very old" });
    const foreign = await createEvent({ organisationId: (await createOrganisationAccount()).organisation.id });
    expect((await listEventOptions(organisation.id, foreign.id)).some((option) => option.id === foreign.id)).toBe(false);
  });

  test("the overview counts drafts beyond the three it names", async () => {
    const { organisation } = await createOrganisationAccount();
    for (let index = 0; index < 5; index += 1) {
      const draft = await createEvent({ organisationId: organisation.id });
      await prisma.event.update({ where: { id: draft.id }, data: { startTime: new Date(Date.now() + (index + 1) * 3600000), endTime: new Date(Date.now() + (index + 2) * 3600000), salesCloseAt: new Date(Date.now() + (index + 1) * 3600000) } });
    }
    const overview = await getOrganisationOverview(organisation.id, "owner");
    expect(overview.drafts).toHaveLength(3);
    expect(overview.draftsSoon).toBe(5);
    expect((await getOrganisationOverview(organisation.id, "check_in_staff")).draftsSoon).toBe(0);
  });
});
