import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { repairOrganisationDrift } from "@/lib/db/organisation-drift";
import { createEvent, createMember, createOrder, createOrganisationAccount, createReservation } from "@/tests/helpers/test-data";

describe("denormalized organisation drift repair", () => {
  test("dry run, guarded repair, and repeat leave canonical ownership intact", async () => {
    const owner = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: owner.organisation.id });
    const ticketTypeId = event.ticketTypes[0].id;
    const order = await createOrder({ organisationId: owner.organisation.id,
      eventId: event.id, ticketTypeId, userId: member.id });
    const reservation = await createReservation({ orderId: order.id,
      organisationId: owner.organisation.id, eventId: event.id, ticketTypeId,
      userId: member.id, quantity: 1, expiresAt: new Date(Date.now() + 3600000) });
    const ticket = await prisma.ticket.create({ data: { orderId: order.id,
      eventId: event.id, ticketTypeId, organisationId: owner.organisation.id } });
    await prisma.order.update({ where: { id: order.id },
      data: { organisationId: other.organisation.id } });
    await prisma.ticket.update({ where: { id: ticket.id },
      data: { organisationId: other.organisation.id } });
    await prisma.ticketReservation.update({ where: { id: reservation.id },
      data: { organisationId: other.organisation.id } });
    const dry = await repairOrganisationDrift();
    expect(dry.map((row) => [row.found, row.repaired])).toEqual([[1, 0], [1, 0], [1, 0]]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).organisationId)
      .toBe(other.organisation.id);
    const repaired = await repairOrganisationDrift({ apply: true });
    expect(repaired.map((row) => row.repaired)).toEqual([1, 1, 1]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).organisationId)
      .toBe(owner.organisation.id);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).organisationId)
      .toBe(owner.organisation.id);
    expect((await prisma.ticketReservation.findUniqueOrThrow({ where: { id: reservation.id } })).organisationId)
      .toBe(owner.organisation.id);
    expect((await repairOrganisationDrift({ apply: true })).map((row) => row.repaired))
      .toEqual([0, 0, 0]);
  });

  test("refuses repair when a ticket points at a different event from its order", async () => {
    const { organisation } = await createOrganisationAccount();
    const first = await createEvent({ organisationId: organisation.id });
    const second = await createEvent({ organisationId: organisation.id });
    const order = await createOrder({ organisationId: organisation.id,
      eventId: first.id, ticketTypeId: first.ticketTypes[0].id });
    const ticket = await prisma.ticket.create({ data: { orderId: order.id,
      eventId: first.id, ticketTypeId: first.ticketTypes[0].id,
      organisationId: organisation.id } });
    await prisma.ticket.update({ where: { id: ticket.id }, data: { eventId: second.id } });
    await expect(repairOrganisationDrift({ apply: true })).rejects.toThrow("relationship mismatch");
  });
});
