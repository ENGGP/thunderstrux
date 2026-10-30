import { describe, expect, test } from "vitest";
import { GET as exportAttendees } from "@/app/api/events/[eventId]/tickets/export/route";
import { GET as exportOrders } from "@/app/api/orders/export/route";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { toCsv } from "@/lib/export/csv";
import { orderReference, ticketReference } from "@/lib/format";
import { selectMockContext, setMockSession } from "@/tests/helpers/auth";
import { routeContext } from "@/tests/helpers/http";
import { createEvent, createMember, createOrder, createOrganisationAccount, createOrganisationStaff } from "@/tests/helpers/test-data";

// UI-018: spreadsheet downloads of a society's orders and an event's attendees.
async function society() {
  const account = await createOrganisationAccount();
  const event = await createEvent({ organisationId: account.organisation.id, status: "published", title: "Quiz night" });
  const buyer = await createMember();
  const paid = await createOrder({ organisationId: account.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, userId: buyer.id, status: "paid", paidAt: new Date(), quantity: 2, unitPrice: 1500 });
  const expired = await createOrder({ organisationId: account.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, userId: buyer.id, status: "expired" });
  const ticket = await prisma.ticket.create({ data: { orderId: paid.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, organisationId: account.organisation.id, issueSequence: 1 } });
  setMockSession({ userId: account.user.id, email: account.user.email, accountRole: "organisation" });
  return { ...account, event, buyer, paid, expired, ticket };
}
const get = (path: string) => exportOrders(new Request(`http://localhost:3000${path}`));

describe("order exports", () => {
  test("cells are quoted, and anything a spreadsheet would run as a formula is defused", () => {
    expect(toCsv(["Name", "Note"], [["=HYPERLINK(\"x\")", 'Said "hi", left'], ["-2+3", null], [12, "@sum"]])).toBe(
      "﻿Name,Note\r\n\"'=HYPERLINK(\"\"x\"\")\",\"Said \"\"hi\"\", left\"\r\n'-2+3,\r\n12,'@sum\r\n"
    );
  });

  test("the ticket orders download holds every order the filters match, only this society's, and is audited", async () => {
    const { organisation, paid, expired } = await society();
    const other = await createOrganisationAccount();
    const theirEvent = await createEvent({ organisationId: other.organisation.id, status: "published" });
    const theirs = await createOrder({ organisationId: other.organisation.id, eventId: theirEvent.id, ticketTypeId: theirEvent.ticketTypes[0].id, status: "paid", paidAt: new Date() });

    const response = await get("/api/orders/export");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toMatch(new RegExp(`^attachment; filename="${organisation.slug}-tickets-orders-\\d{4}-\\d{2}-\\d{2}\\.csv"$`));
    // A byte-order mark first, so Excel reads names as UTF-8 (text() drops it).
    expect([...new Uint8Array(await response.clone().arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = await response.text();
    expect(csv.split("\r\n")[0]).toBe("Order,Ordered,Event,Ticket type,Quantity,Total,Currency,Code,Discount,Status,Paid,Buyer email");
    expect(csv).toContain(`${orderReference(paid.id)},`);
    expect(csv).toContain(",Quiz night,");
    expect(csv).toContain(",2,30.00,AUD,,,Paid,");
    expect(csv).toContain(orderReference(expired.id));
    expect(csv).not.toContain(orderReference(theirs.id));

    const onlyPaid = await (await get("/api/orders/export?status=paid")).text();
    expect(onlyPaid).toContain(orderReference(paid.id));
    expect(onlyPaid).not.toContain(orderReference(expired.id));
    const audit = await prisma.auditLog.findMany({ where: { organisationId: organisation.id, action: "order.list_exported" }, orderBy: { createdAt: "asc" } });
    expect(audit.map((row) => row.metadata)).toEqual([
      { family: "tickets", rows: 2, filters: { status: "all" } },
      { family: "tickets", rows: 1, filters: { status: "paid" } }
    ]);
  });

  test("membership orders download with their plan and term", async () => {
    const { organisation, buyer } = await society();
    const term = { startsAt: new Date("2026-02-01T00:00:00+10:00"), endsAt: new Date("2026-07-01T00:00:00+10:00") };
    const plan = await prisma.membershipProduct.create({ data: { organisationId: organisation.id, name: "Semester 1", priceAmount: 0, ...term, status: "published", publishedAt: new Date() } });
    const order = await prisma.$transaction((tx) => createCommerceOrder(tx, {
      organisationId: organisation.id, kind: "membership", buyer: { userId: buyer.id }, buyerEmail: buyer.email, buyerName: "Sam Lee", paymentKind: "free", source: "checkout",
      lines: [{ quantity: 1, unitAmount: 0, name: plan.name, termStartsAt: term.startsAt, termEndsAt: term.endsAt, membershipProductId: plan.id }]
    }));
    await prisma.commerceOrder.update({ where: { id: order.id }, data: { status: "paid", paidAt: new Date(), fulfilledAt: new Date() } });
    const csv = await (await get("/api/orders/export?family=memberships")).text();
    expect(csv.split("\r\n")[0]).toBe("Order,Ordered,Buyer,Buyer email,Guest,Plan,Starts,Ends,Total,Currency,Payment");
    expect(csv).toContain(`${orderReference(order.id)},`);
    expect(csv).toContain(`,Sam Lee,${buyer.email},No,Semester 1,2026-02-01,2026-06-30,0.00,AUD,Free`);
  });

  test("the attendee list downloads for owners and admins only, and is audited", async () => {
    const { organisation, event, ticket, buyer } = await society();
    const response = await exportAttendees(new Request(`http://localhost:3000/api/events/${event.id}/tickets/export`), routeContext({ eventId: event.id }));
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv.split("\r\n")[0]).toBe("Ticket,Name,Email,Guest,Ticket type,Ticket of order,Order,Checked in,Checked in at,Checked in by");
    expect(csv).toContain(`${ticketReference(ticket.id)},`);
    expect(csv).toContain(buyer.email);
    expect(csv).toContain(",1 of 2,");
    expect(await prisma.auditLog.count({ where: { organisationId: organisation.id, action: "order.attendees_exported", targetId: event.id } })).toBe(1);

    // Door staff and event managers see the list on screen, but can't take the emails away.
    for (const role of ["check_in_staff", "event_manager"] as const) {
      const member = await createMember();
      await createOrganisationStaff({ organisationId: organisation.id, userId: member.id, role });
      setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
      selectMockContext({ mode: "staff", organisationId: organisation.id });
      expect((await exportAttendees(new Request(`http://localhost:3000/api/events/${event.id}/tickets/export`), routeContext({ eventId: event.id }))).status).toBe(403);
      expect((await get("/api/orders/export")).status).toBe(403);
    }
    // Another society's event is not found.
    const other = await createOrganisationAccount();
    setMockSession({ userId: other.user.id, email: other.user.email, accountRole: "organisation" });
    selectMockContext({ mode: "staff", organisationId: other.organisation.id });
    expect((await exportAttendees(new Request(`http://localhost:3000/api/events/${event.id}/tickets/export`), routeContext({ eventId: event.id }))).status).toBe(404);
  });
});
