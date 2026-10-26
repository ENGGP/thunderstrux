import { describe, expect, test, vi } from "vitest";
import { PATCH as updateEventRoute } from "@/app/api/events/[eventId]/route";
import { POST as checkoutRoute } from "@/app/api/payments/checkout/event/route";
import { prisma } from "@/lib/db";
import { readEventInventory, sellableQuantity } from "@/lib/events/inventory";
import { createEventCheckout } from "@/lib/payments/checkout-creation";
import { reconcileCompletedCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { checkoutSession } from "@/tests/helpers/stripe-mocks";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount,
  unique
} from "@/tests/helpers/test-data";

const stripeMocks = vi.hoisted(() => ({ createSession: vi.fn() }));

vi.mock("@/lib/stripe", () => {
  class StripeConfigurationError extends Error {}

  return {
    StripeConfigurationError,
    getAppUrl: () => "http://localhost:3000",
    getStripe: () => ({ checkout: { sessions: { create: stripeMocks.createSession } } })
  };
});

type TestEvent = Awaited<ReturnType<typeof createEvent>>;

function mockSessions() {
  stripeMocks.createSession.mockClear();
  let next = 0;
  stripeMocks.createSession.mockImplementation(async () => {
    next += 1;
    return { id: `cs_inventory_${next}_${Date.now()}`, url: "https://checkout.stripe.test/session" };
  });
}

function buy(userId: string, event: TestEvent, index: number, quantity: number, expectedUnitPrice = event.ticketTypes[index].price) {
  return createEventCheckout({ userId, eventId: event.id, ticketTypeId: event.ticketTypes[index].id, quantity, expectedUnitPrice, idempotencyKey: unique("checkout") });
}

function editStock(
  event: TestEvent,
  version: number,
  ticketType: { id: string; name: string; price: number; quantity: number; expectedQuantity: number },
  extra: Record<string, unknown> = {}
) {
  return updateEventRoute(
    jsonRequest(`http://localhost/api/events/${event.id}`, {
      organisationId: event.organisationId,
      title: event.title,
      description: event.description,
      location: event.location,
      startTime: event.startTime.toISOString(),
      endTime: event.endTime.toISOString(),
      version,
      ticketTypes: [ticketType],
      ...extra
    }, { method: "PATCH" }),
    routeContext({ eventId: event.id })
  );
}

async function sellable(event: TestEvent, index = 0) {
  const ticketType = await prisma.ticketType.findUniqueOrThrow({ where: { id: event.ticketTypes[index].id } });
  return sellableQuantity(ticketType, await readEventInventory(prisma, event.id, new Date()));
}

describe("inventory and capacity locks", () => {
  test("two ticket types racing for the last seat under capacity sell it once", async () => {
    mockSessions();
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published",
      capacity: 1,
      ticketTypes: [{ name: "Standard", price: 1000, quantity: 5 }, { name: "Supporter", price: 2000, quantity: 5 }]
    });
    const [first, second] = [await createMember(), await createMember()];

    const results = await Promise.allSettled([buy(first.id, event, 0, 1), buy(second.id, event, 1, 1)]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { kind: "sold_out" }
    });
    expect(await prisma.ticketReservation.count({ where: { eventId: event.id, status: "active" } })).toBe(1);
    expect(await sellable(event, 0)).toBe(0);
    expect(await sellable(event, 1)).toBe(0);
  });

  test("capacity counts issued tickets and active holds across types", async () => {
    mockSessions();
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({ organisationId: organisation.id, status: "published", capacity: 3 });
    const order = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: event.ticketTypes[0].id,
      status: "paid",
      paidAt: new Date(),
      quantity: 2
    });
    for (const issueSequence of [1, 2]) {
      await prisma.ticket.create({
        data: { issueSequence, orderId: order.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, organisationId: organisation.id }
      });
    }
    const member = await createMember();

    await expect(buy(member.id, event, 0, 2)).rejects.toMatchObject({ kind: "insufficient_availability" });
    await expect(buy(member.id, event, 0, 1)).resolves.toMatchObject({ url: expect.any(String) });
    expect(await sellable(event)).toBe(0);
  });

  test("tickets under dispute review keep their places, so restoring them after a won dispute can't oversell", async () => {
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({ organisationId: organisation.id, status: "published", capacity: 2 });
    const order = await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, status: "paid", paidAt: new Date(), quantity: 2 });
    for (const issueSequence of [1, 2]) {
      await prisma.ticket.create({
        data: { issueSequence, orderId: order.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, organisationId: organisation.id, validity: "refund_review", validityReason: "disputed" }
      });
    }
    expect(await sellable(event)).toBe(0);
    // A lost dispute voids them, and only then are the places free.
    await prisma.ticket.updateMany({ where: { orderId: order.id }, data: { validity: "void", validityReason: "dispute_lost" } });
    expect(await sellable(event)).toBe(2);
  });

  test("a price changed after the buyer saw it is a 409 before any hold", async () => {
    mockSessions();
    const { organisation, user } = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({ organisationId: organisation.id, status: "published" });
    const shownPrice = event.ticketTypes[0].price;
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    expect((await editStock(event, event.version, {
      id: event.ticketTypes[0].id, name: "General", price: shownPrice + 500, quantity: 10, expectedQuantity: 10
    })).status).toBe(200);

    const member = await createMember();
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    const response = await checkoutRoute(jsonRequest("http://localhost/api/payments/checkout/event", {
      eventId: event.id, ticketTypeId: event.ticketTypes[0].id, quantity: 1, expectedUnitPrice: shownPrice, idempotencyKey: unique("checkout")
    }));

    expect(response.status).toBe(409);
    expect(await parseJsonResponse(response)).toMatchObject({
      error: { code: "CONFLICT", details: [{ path: ["expectedUnitPrice"], reason: "quote_changed", value: shownPrice + 500, message: expect.stringContaining("$17.00") }] }
    });
    expect(await prisma.order.count({ where: { eventId: event.id } })).toBe(0);
    expect(stripeMocks.createSession).not.toHaveBeenCalled();

    const tooMany = await checkoutRoute(jsonRequest("http://localhost/api/payments/checkout/event", {
      eventId: event.id, ticketTypeId: event.ticketTypes[0].id, quantity: 11, expectedUnitPrice: shownPrice + 500, idempotencyKey: unique("checkout")
    }));
    expect(tooMany.status).toBe(400);

    // The checkout page offers the count that is left, read from the detail rather than the message.
    await prisma.ticketType.update({ where: { id: event.ticketTypes[0].id }, data: { quantity: 3 } });
    const short = await checkoutRoute(jsonRequest("http://localhost/api/payments/checkout/event", {
      eventId: event.id, ticketTypeId: event.ticketTypes[0].id, quantity: 4, expectedUnitPrice: shownPrice + 500, idempotencyKey: unique("checkout")
    }));
    expect(short.status).toBe(400);
    expect(await parseJsonResponse(short)).toMatchObject({
      error: { details: [{ path: ["quantity"], reason: "insufficient_availability", value: 3 }] }
    });
  });

  test("an edit cannot drop stock below active holds and keeps stock sold since the form loaded", async () => {
    mockSessions();
    const { organisation, user } = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({ organisationId: organisation.id, status: "published" });
    const ticketType = event.ticketTypes[0];
    await buy((await createMember()).id, event, 0, 3);
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });

    const belowHolds = await editStock(event, 1, { id: ticketType.id, name: "General", price: ticketType.price, quantity: 2, expectedQuantity: 10 });
    expect(belowHolds.status).toBe(400);
    expect(JSON.stringify(await parseJsonResponse(belowHolds))).toContain("Keep at least 3 remaining");

    // A sale lands after the organiser opened the form (fulfilment decrements remaining stock).
    await prisma.ticketType.update({ where: { id: ticketType.id }, data: { quantity: 7 } });
    const untouched = await editStock(event, 1, { id: ticketType.id, name: "Renamed", price: ticketType.price, quantity: 10, expectedQuantity: 10 });
    expect(untouched.status).toBe(200);
    expect((await parseJsonResponse(untouched)).event.ticketTypes[0]).toMatchObject({ name: "Renamed", quantity: 7 });

    await prisma.ticketType.update({ where: { id: ticketType.id }, data: { quantity: 6 } });
    const changed = await editStock(event, 2, { id: ticketType.id, name: "Renamed", price: ticketType.price, quantity: 12, expectedQuantity: 7 });
    expect(changed.status).toBe(409);
    expect((await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketType.id } })).quantity).toBe(6);
  });

  test("an edit racing a checkout never lets both take the same stock", async () => {
    mockSessions();
    const { organisation, user } = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published",
      ticketTypes: [{ name: "General", price: 1500, quantity: 2 }]
    });
    const ticketType = event.ticketTypes[0];
    const member = await createMember();
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });

    const [checkout, edit] = await Promise.allSettled([
      buy(member.id, event, 0, 2),
      editStock(event, 1, { id: ticketType.id, name: "General", price: 1500, quantity: 1, expectedQuantity: 2 })
    ]);
    const editStatus = edit.status === "fulfilled" ? edit.value.status : 500;

    // Checkout first: the edit sees 2 held and refuses. Edit first: only 1 remains to buy.
    expect(checkout.status === "fulfilled" && editStatus === 200).toBe(false);
    expect([checkout.status === "fulfilled", editStatus === 200]).toContain(true);
    expect(await sellable(event)).toBeGreaterThanOrEqual(0);
  });

  test("fulfilment racing an edit keeps stock non-negative and issues every paid ticket", async () => {
    mockSessions();
    const { organisation, user } = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published",
      ticketTypes: [{ name: "General", price: 1500, quantity: 3 }]
    });
    const ticketType = event.ticketTypes[0];
    await buy((await createMember()).id, event, 0, 2);
    const order = await prisma.order.findFirstOrThrow({ where: { eventId: event.id } });
    const session = checkoutSession({
      id: order.stripeSessionId ?? "cs_missing",
      orderId: order.id,
      eventId: event.id,
      organisationId: organisation.id,
      ticketTypeId: ticketType.id,
      quantity: 2,
      amountTotal: 3000
    });
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });

    const [fulfilment, edit] = await Promise.allSettled([
      reconcileCompletedCheckoutSession(session, { stripeEventId: `evt_${order.id}` }),
      editStock(event, 1, { id: ticketType.id, name: "General", price: 1500, quantity: 2, expectedQuantity: 3 })
    ]);
    const editStatus = edit.status === "fulfilled" ? edit.value.status : 500;
    const remaining = (await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketType.id } })).quantity;

    expect(fulfilment).toMatchObject({ status: "fulfilled", value: { status: "fulfilled" } });
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(2);
    // Edit first: 2 remain, fulfilment takes both. Fulfilment first: 1 remains and the stale edit is a 409.
    expect([editStatus, remaining]).toEqual(editStatus === 200 ? [200, 0] : [409, 1]);
  });

  test("closing sales racing a checkout either sells before the close or refuses after it", async () => {
    mockSessions();
    const { organisation, user } = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({ organisationId: organisation.id, status: "published" });
    const { PATCH: salesRoute } = await import("@/app/api/events/[eventId]/sales/route");
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });

    const [checkout, close] = await Promise.allSettled([
      buy((await createMember()).id, event, 0, 1),
      salesRoute(jsonRequest(`http://localhost/api/events/${event.id}/sales`, { saleState: "closed", version: 1 }, { method: "PATCH" }), routeContext({ eventId: event.id }))
    ]);

    expect(close).toMatchObject({ status: "fulfilled", value: { status: 200 } });
    if (checkout.status === "rejected") expect(checkout.reason).toMatchObject({ kind: "sales_closed" });
    // The close and the hold serialise on the Event row: an order exists only if checkout won.
    expect(await prisma.order.count({ where: { eventId: event.id } })).toBe(checkout.status === "fulfilled" ? 1 : 0);
  });

  // A ticket release: every buyer gets a ticket or a sold-out answer, never an error.
  test("a rush of 30 buyers for 20 free tickets gives 20 tickets and 10 sold-out answers", async () => {
    const { organisation } = await createOrganisationAccount();
    const event = await createEvent({ organisationId: organisation.id, status: "published", ticketTypes: [{ name: "Free entry", price: 0, quantity: 20 }] });
    const members = await Promise.all(Array.from({ length: 30 }, () => createMember()));

    const results = await Promise.allSettled(members.map((member) => buy(member.id, event, 0, 1)));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(20);
    for (const result of results) if (result.status === "rejected") expect(["sold_out", "insufficient_availability"]).toContain(result.reason?.kind);
    expect(await prisma.ticket.count({ where: { eventId: event.id } })).toBe(20);
    expect((await prisma.ticketType.findUniqueOrThrow({ where: { id: event.ticketTypes[0].id } })).quantity).toBe(0);
  });

  test("a rush of 30 buyers for 20 paid tickets holds 20, and their payments all fulfil at once", async () => {
    mockSessions();
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({ organisationId: organisation.id, status: "published", ticketTypes: [{ name: "General", price: 1500, quantity: 20 }] });
    const members = await Promise.all(Array.from({ length: 30 }, () => createMember()));

    const results = await Promise.allSettled(members.map((member) => buy(member.id, event, 0, 1)));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(20);
    for (const result of results) if (result.status === "rejected") expect(["sold_out", "insufficient_availability"]).toContain(result.reason?.kind);
    const orders = await prisma.order.findMany({ where: { eventId: event.id, status: "pending" } });
    expect(orders).toHaveLength(20);

    const fulfilled = await Promise.all(orders.map((order) => reconcileCompletedCheckoutSession(checkoutSession({
      id: order.stripeSessionId ?? "cs_missing", orderId: order.id, eventId: event.id, organisationId: organisation.id,
      ticketTypeId: event.ticketTypes[0].id, quantity: 1, amountTotal: 1500
    }), { stripeEventId: `evt_${order.id}` })));

    expect(fulfilled.map((result) => result.status)).toEqual(Array(20).fill("fulfilled"));
    expect(await prisma.ticket.count({ where: { eventId: event.id } })).toBe(20);
    expect((await prisma.ticketType.findUniqueOrThrow({ where: { id: event.ticketTypes[0].id } })).quantity).toBe(0);
  });

  test("deleting an event re-checks orders under the event lock", async () => {
    mockSessions();
    const { organisation, user } = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({ organisationId: organisation.id, status: "published" });
    const { DELETE } = await import("@/app/api/events/[eventId]/route");
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });

    const [checkout, removal] = await Promise.allSettled([
      buy((await createMember()).id, event, 0, 1),
      DELETE(jsonRequest(`http://localhost/api/events/${event.id}`, undefined, { method: "DELETE" }), routeContext({ eventId: event.id }))
    ]);
    const removed = removal.status === "fulfilled" && removal.value.status === 200;

    // Either the order exists and the event stays, or the event went first and checkout found nothing.
    expect(checkout.status === "fulfilled" && removed).toBe(false);
    if (removed) expect(checkout).toMatchObject({ status: "rejected", reason: { kind: "event_not_found" } });
    else expect(await prisma.event.count({ where: { id: event.id } })).toBe(1);
  });

  test("unpublishing re-checks orders under the event lock, so a draft never has orders (SEC-009)", async () => {
    mockSessions();
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({ organisationId: organisation.id, status: "published" });
    const { setOrganisationEventPublication } = await import("@/lib/events/event-lifecycle");

    const [checkout, unpublish] = await Promise.allSettled([
      buy((await createMember()).id, event, 0, 1),
      setOrganisationEventPublication(organisation.id, event.id, { targetStatus: "draft", version: event.version })
    ]);

    // Either the order landed and the event stays published, or the event went draft first and checkout refused.
    expect(checkout.status === "fulfilled" && unpublish.status === "fulfilled").toBe(false);
    const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id }, select: { status: true, _count: { select: { orders: true } } } });
    expect(after.status === "draft" && after._count.orders > 0).toBe(false);
  });
});
