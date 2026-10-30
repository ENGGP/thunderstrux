import { describe, expect, test, vi } from "vitest";
import { POST as createCodeRoute } from "@/app/api/events/[eventId]/codes/route";
import { PATCH as updateCodeRoute } from "@/app/api/events/[eventId]/codes/[codeId]/route";
import { POST as checkoutRoute } from "@/app/api/payments/checkout/event/route";
import { prisma } from "@/lib/db";
import { getPublishedEventDetail, listingAvailability } from "@/lib/events/public-events";
import { createEventCheckout } from "@/lib/payments/checkout-creation";
import { reconcileCompletedCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import { openOrderRefund } from "@/lib/payments/order-refunds";
import { calculatePlatformFee } from "@/lib/stripe/fees";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { checkoutSession } from "@/tests/helpers/stripe-mocks";
import { createEvent, createMember, createMembershipGrant, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

const stripe = vi.hoisted(() => ({ createSession: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  StripeConfigurationError: class StripeConfigurationError extends Error {},
  getAppUrl: () => "http://localhost:3000",
  getStripe: () => ({ checkout: { sessions: { create: stripe.createSession } } })
}));
stripe.createSession.mockImplementation(async () => ({ id: unique("cs_code"), url: "https://checkout.stripe.test/session" }));

// General is on sale to everyone; Crew is hidden until an access code unlocks it.
async function codedEvent({ memberPrice = null as number | null } = {}) {
  const owner = await createOrganisationAccount({ stripeReady: true });
  const event = await createEvent({
    organisationId: owner.organisation.id,
    status: "published",
    ticketTypes: [{ name: "General", price: 2000, memberPrice, quantity: 20 }, { name: "Crew", price: 3000, quantity: 5, hidden: true }]
  });
  const type = (name: string) => event.ticketTypes.find((ticketType) => ticketType.name === name)!;
  return { owner, event, general: type("General"), crew: type("Crew") };
}

type Fixture = Awaited<ReturnType<typeof codedEvent>>;

async function addCode(fixture: Fixture, body: Record<string, unknown>) {
  setMockSession({ userId: fixture.owner.user.id, email: fixture.owner.user.email, accountRole: "organisation" });
  const response = await createCodeRoute(jsonRequest(`http://localhost/api/events/${fixture.event.id}/codes`, { ticketTypeId: null, ...body }), routeContext({ eventId: fixture.event.id }));
  return { status: response.status, body: await parseJsonResponse(response) };
}

async function changeCode(fixture: Fixture, codeId: string, body: Record<string, unknown>) {
  setMockSession({ userId: fixture.owner.user.id, email: fixture.owner.user.email, accountRole: "organisation" });
  return updateCodeRoute(jsonRequest(`http://localhost/api/events/${fixture.event.id}/codes/${codeId}`, body, { method: "PATCH" }), routeContext({ eventId: fixture.event.id, codeId }));
}

function buy(userId: string, fixture: Fixture, ticketTypeId: string, quantity: number, expectedUnitPrice: number, code?: string) {
  return createEventCheckout({ userId, eventId: fixture.event.id, ticketTypeId, quantity, expectedUnitPrice, code, idempotencyKey: unique("code-key") });
}

async function fulfil(fixture: Fixture, orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  return reconcileCompletedCheckoutSession(checkoutSession({
    id: order.stripeSessionId ?? "cs_missing", orderId, eventId: fixture.event.id, organisationId: fixture.owner.organisation.id,
    ticketTypeId: order.ticketTypeId, quantity: order.quantity, amountTotal: order.totalAmount
  }), { stripeEventId: `evt_${orderId}` });
}

describe("ticket codes", () => {
  test("staff add discount, access and comp codes: case-blind, one per text per event, never under the paid minimum, and only on their own society's events", async () => {
    const fixture = await codedEvent();
    const created = await addCode(fixture, { code: "sponsor", percentOff: 25 });
    expect(created).toMatchObject({ status: 201, body: { code: { code: "SPONSOR", percentOff: 25, amountOff: null, ticketTypeId: null } } });
    expect(await addCode(fixture, { code: "Sponsor", percentOff: 10 })).toMatchObject({ status: 400, body: { error: { details: [{ path: ["code"] }] } } });
    // $20.00 less $19.00 would be a $1.00 paid ticket.
    expect(await addCode(fixture, { code: "CHEAP", amountOff: 1900 })).toMatchObject({ status: 400, body: { error: { details: [{ path: ["amountOff"] }] } } });
    // A visible type needs a discount; only a hidden one may be unlocked by a code alone.
    expect(await addCode(fixture, { code: "LOOK", ticketTypeId: fixture.general.id })).toMatchObject({ status: 400, body: { error: { details: [{ path: ["percentOff"] }] } } });
    expect(await addCode(fixture, { code: "CREW", ticketTypeId: fixture.crew.id, percentOff: 100, maxUses: 2 })).toMatchObject({ status: 201 });
    const elsewhere = await codedEvent();
    expect(await addCode(fixture, { code: "OTHER", ticketTypeId: elsewhere.general.id, percentOff: 10 })).toMatchObject({ status: 400, body: { error: { details: [{ path: ["ticketTypeId"] }] } } });
    // Another society's staff can't see the event at all.
    expect((await addCode({ ...elsewhere, event: fixture.event }, { code: "THEIRS", percentOff: 10 })).status).toBe(404);

    expect(await prisma.auditLog.findMany({ where: { targetId: fixture.event.id, action: "event.code_created" }, select: { actorUserId: true, metadata: true }, orderBy: { createdAt: "asc" } })).toEqual([
      { actorUserId: fixture.owner.user.id, metadata: { code: "SPONSOR", does: "25% off every ticket", maxUses: null, endsAt: null } },
      { actorUserId: fixture.owner.user.id, metadata: { code: "CREW", does: "free Crew", maxUses: 2, endsAt: null } }
    ]);
  });

  test("a hidden type stays out of public reads and checkout until its access code unlocks it, and a 100% code is a free comp with no Stripe call", async () => {
    const fixture = await codedEvent();
    await addCode(fixture, { code: "CREW", ticketTypeId: fixture.crew.id, percentOff: 100 });
    const member = await createMember();
    stripe.createSession.mockClear();

    expect((await getPublishedEventDetail(fixture.event.id))?.ticketTypes.map((type) => type.name)).toEqual(["General"]);
    expect((await getPublishedEventDetail(fixture.event.id, fixture.crew.id))?.ticketTypes.map((type) => type.name).sort()).toEqual(["Crew", "General"]);
    expect((await listingAvailability([fixture.event.id])).get(fixture.event.id)).toEqual({ state: "on_sale", prices: [2000] });

    await expect(buy(member.id, fixture, fixture.crew.id, 1, 3000)).rejects.toMatchObject({ kind: "ticket_type_not_found" });
    await expect(buy(member.id, fixture, fixture.crew.id, 1, 3000, "WRONG")).rejects.toMatchObject({ kind: "ticket_type_not_found" });
    const comp = await buy(member.id, fixture, fixture.crew.id, 2, 0, "crew");
    expect(comp).toMatchObject({ status: "fulfilled" });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: (comp as { orderId: string }).orderId }, include: { tickets: true } });
    expect(order).toMatchObject({ paymentKind: "free", status: "paid", unitPrice: 0, totalAmount: 0, feeAmount: 0, codeSnapshot: "CREW", discountAmount: 6000 });
    expect(order.tickets).toHaveLength(2);
    expect(stripe.createSession).not.toHaveBeenCalled();
  });

  test("a discount prices the order, its fee and the Stripe charge from the discounted price; the quote check holds; a code for another type is ignored", async () => {
    const fixture = await codedEvent();
    await addCode(fixture, { code: "SPONSOR", percentOff: 25 });
    await addCode(fixture, { code: "CREW", ticketTypeId: fixture.crew.id, percentOff: 100 });
    const member = await createMember();
    stripe.createSession.mockClear();

    await expect(buy(member.id, fixture, fixture.general.id, 2, 2000, "SPONSOR")).rejects.toMatchObject({ kind: "quote_changed", details: [{ value: 1500 }] });
    expect(await buy(member.id, fixture, fixture.general.id, 2, 1500, "SPONSOR")).toMatchObject({ status: "redirect" });
    const order = await prisma.order.findFirstOrThrow({ where: { eventId: fixture.event.id, userId: member.id } });
    expect(order).toMatchObject({ unitPrice: 1500, totalAmount: 3000, feeAmount: calculatePlatformFee(3000, 2), codeSnapshot: "SPONSOR", discountAmount: 1000 });
    const [request] = stripe.createSession.mock.calls[0] as [{ line_items: Array<{ price_data: { unit_amount: number; product_data: { description?: string } } }>; payment_intent_data: { application_fee_amount: number } }];
    expect(request.line_items[0].price_data).toMatchObject({ unit_amount: 1500, product_data: { description: "Code SPONSOR" } });
    expect(request.payment_intent_data.application_fee_amount).toBe(calculatePlatformFee(3000, 2));

    const other = await createMember();
    expect(await buy(other.id, fixture, fixture.general.id, 1, 2000, "CREW")).toMatchObject({ status: "redirect" });
    expect(await prisma.order.findFirstOrThrow({ where: { eventId: fixture.event.id, userId: other.id } })).toMatchObject({ ticketCodeId: null, discountAmount: 0, unitPrice: 2000 });
  });

  test("a code's ticket limit holds under a rush, and a lapsed hold or a voided ticket gives its use back", async () => {
    const fixture = await codedEvent();
    const { body } = await addCode(fixture, { code: "LIMIT3", percentOff: 10, maxUses: 3 });
    const members = await Promise.all(Array.from({ length: 6 }, () => createMember()));

    const rush = await Promise.allSettled(members.map((member) => buy(member.id, fixture, fixture.general.id, 1, 1800, "LIMIT3")));
    expect(rush.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    for (const result of rush) if (result.status === "rejected") expect(result.reason).toMatchObject({ kind: "code_unavailable", message: "That code has been used up." });

    const [paid, lapsed] = await prisma.order.findMany({ where: { ticketCodeId: body.code.id }, orderBy: { createdAt: "asc" } });
    expect(await fulfil(fixture, paid.id)).toMatchObject({ status: "fulfilled" });
    await prisma.ticketReservation.update({ where: { orderId: lapsed.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const late = await createMember();
    expect(await buy(late.id, fixture, fixture.general.id, 1, 1800, "LIMIT3")).toMatchObject({ status: "redirect" });
    await expect(buy((await createMember()).id, fixture, fixture.general.id, 1, 1800, "LIMIT3")).rejects.toMatchObject({ kind: "code_unavailable" });

    // A refunded or cancelled ticket is void, so it stops counting, as its place goes back on sale.
    await prisma.ticket.updateMany({ where: { orderId: paid.id }, data: { validity: "void", validityReason: "refunded", validityChangedAt: new Date() } });
    const again = await createMember();
    await expect(buy(again.id, fixture, fixture.general.id, 2, 1800, "LIMIT3")).rejects.toMatchObject({ kind: "code_unavailable", details: [{ value: 1 }] });
    expect(await buy(again.id, fixture, fixture.general.id, 1, 1800, "LIMIT3")).toMatchObject({ status: "redirect" });
  });

  test("an ended or turned-off code is refused at checkout with 409; staff can extend it or turn it back on, and each change is audited", async () => {
    const fixture = await codedEvent();
    const { body } = await addCode(fixture, { code: "EARLY", percentOff: 10, endsAt: new Date(Date.now() + 86_400_000).toISOString() });
    const member = await createMember();
    const attempt = (key = unique("code-route")) => {
      setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
      return checkoutRoute(jsonRequest("http://localhost/api/payments/checkout/event", { eventId: fixture.event.id, ticketTypeId: fixture.general.id, quantity: 1, expectedUnitPrice: 1800, code: "early", idempotencyKey: key }));
    };

    expect((await changeCode(fixture, body.code.id, { endsAt: new Date(Date.now() - 1000).toISOString() })).status).toBe(200);
    const ended = await attempt();
    expect(ended.status).toBe(409);
    expect(await parseJsonResponse(ended)).toMatchObject({ error: { details: [{ reason: "code_unavailable", message: "That code has expired." }] } });

    expect((await changeCode(fixture, body.code.id, { endsAt: null, disabled: true })).status).toBe(200);
    expect(await parseJsonResponse(await attempt())).toMatchObject({ error: { details: [{ message: "That code has been turned off." }] } });

    expect((await changeCode(fixture, body.code.id, { disabled: false })).status).toBe(200);
    expect((await attempt()).status).toBe(200);
    expect((await prisma.auditLog.findMany({ where: { targetId: fixture.event.id, action: "event.code_updated" }, orderBy: { createdAt: "asc" } })).map((row) => Object.keys((row.metadata as { changes: object }).changes).sort())).toEqual([
      ["endsAt"], ["endsAt", "on"], ["on"]
    ]);
  });

  test("a code takes its discount off the member price, and a refund pays back only what was paid", async () => {
    const fixture = await codedEvent({ memberPrice: 1600 });
    await addCode(fixture, { code: "SPONSOR", percentOff: 25 });
    const member = await createMember();
    const grant = await createMembershipGrant(fixture.owner.organisation.id, member.id, member.email);

    expect(await buy(member.id, fixture, fixture.general.id, 1, 1200, "SPONSOR")).toMatchObject({ status: "redirect" });
    const order = await prisma.order.findFirstOrThrow({ where: { eventId: fixture.event.id, userId: member.id } });
    expect(order).toMatchObject({ unitPrice: 1200, totalAmount: 1200, membershipGrantId: grant.id, discountAmount: 400 });
    expect(await fulfil(fixture, order.id)).toMatchObject({ status: "fulfilled" });

    // Their one ticket at the member price is used, so the code now comes off the standard price.
    expect(await buy(member.id, fixture, fixture.general.id, 2, 1500, "SPONSOR")).toMatchObject({ status: "redirect" });
    expect(await prisma.order.findFirstOrThrow({ where: { eventId: fixture.event.id, userId: member.id, id: { not: order.id } } })).toMatchObject({ unitPrice: 1500, membershipGrantId: null, discountAmount: 1000 });

    const [ticket] = await prisma.ticket.findMany({ where: { orderId: order.id }, orderBy: { issueSequence: "asc" } });
    const refund = (selection?: Parameters<typeof openOrderRefund>[1]["selection"]) =>
      prisma.$transaction((tx) => openOrderRefund(tx, { organisationId: fixture.owner.organisation.id, orderId: order.id, actor: { id: fixture.owner.user.id }, reason: "Buyer can no longer attend.", selection }));
    // One ticket was $12.00 with the code, whatever its list price.
    await expect(refund({ ticketIds: [ticket.id], amount: 1201, cancelTickets: true, notifyBuyer: false })).rejects.toMatchObject({ kind: "invalid_selection" });
    expect(await refund()).toMatchObject({ amount: 1200 });
  });

  test("a code that would leave a paid price under $2.00 after a price edit is refused at checkout, not made free", async () => {
    const fixture = await codedEvent();
    await addCode(fixture, { code: "HALF", percentOff: 50 });
    await prisma.ticketType.update({ where: { id: fixture.general.id }, data: { price: 300 } });
    await expect(buy((await createMember()).id, fixture, fixture.general.id, 1, 150, "HALF")).rejects.toMatchObject({ kind: "code_unavailable" });
    expect(await prisma.order.count({ where: { eventId: fixture.event.id } })).toBe(0);
  });

  test("an old price under $2.00 is refused without blaming a code nobody used", async () => {
    const fixture = await codedEvent();
    await prisma.ticketType.update({ where: { id: fixture.general.id }, data: { price: 150 } });
    const refused = await buy((await createMember()).id, fixture, fixture.general.id, 1, 150).catch((error) => error);
    expect(refused).toMatchObject({ kind: "price_below_minimum" });
    expect(refused.message).not.toContain("code");
    expect(await prisma.order.count({ where: { eventId: fixture.event.id } })).toBe(0);
  });
});
