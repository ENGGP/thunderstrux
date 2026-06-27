import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount,
  createReservation
} from "@/tests/helpers/test-data";

async function createConstraintFixture() {
  const { organisation } = await createOrganisationAccount();
  const member = await createMember();
  const event = await createEvent({ organisationId: organisation.id });
  const ticketType = event.ticketTypes[0];
  const order = await createOrder({
    organisationId: organisation.id,
    eventId: event.id,
    ticketTypeId: ticketType.id,
    userId: member.id,
    unitPrice: ticketType.price
  });

  return { organisation, member, event, ticketType, order };
}

describe("database numeric integrity constraints", () => {
  test("valid numeric inventory, order, and reservation writes succeed", async () => {
    const { organisation, member, event, ticketType, order } =
      await createConstraintFixture();

    await expect(
      prisma.ticketType.create({
        data: {
          eventId: event.id,
          name: "Free waitlist",
          price: 0,
          quantity: 0
        }
      })
    ).resolves.toMatchObject({ price: 0, quantity: 0 });

    await expect(
      prisma.order.create({
        data: {
          organisationId: organisation.id,
          eventId: event.id,
          ticketTypeId: ticketType.id,
          userId: member.id,
          quantity: 1,
          unitPrice: 0,
          totalAmount: 0
        }
      })
    ).resolves.toMatchObject({ quantity: 1, unitPrice: 0, totalAmount: 0 });

    await expect(
      createReservation({
        orderId: order.id,
        organisationId: organisation.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        userId: member.id,
        quantity: 1,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000)
      })
    ).resolves.toMatchObject({ quantity: 1 });
  });

  test("rejects negative ticket type quantity and price at the database layer", async () => {
    const { ticketType } = await createConstraintFixture();

    await expect(
      prisma.ticketType.update({
        where: { id: ticketType.id },
        data: { quantity: -1 }
      })
    ).rejects.toThrow();

    await expect(
      prisma.ticketType.update({
        where: { id: ticketType.id },
        data: { price: -1 }
      })
    ).rejects.toThrow();
  });

  test("rejects non-positive order quantity and negative order amounts at the database layer", async () => {
    const { order } = await createConstraintFixture();

    await expect(
      prisma.order.update({
        where: { id: order.id },
        data: { quantity: 0 }
      })
    ).rejects.toThrow();

    await expect(
      prisma.order.update({
        where: { id: order.id },
        data: { unitPrice: -1 }
      })
    ).rejects.toThrow();

    await expect(
      prisma.order.update({
        where: { id: order.id },
        data: { totalAmount: -1 }
      })
    ).rejects.toThrow();
  });

  test("rejects non-positive reservation quantity at the database layer", async () => {
    const { organisation, member, event, ticketType, order } =
      await createConstraintFixture();

    await expect(
      createReservation({
        orderId: order.id,
        organisationId: organisation.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        userId: member.id,
        quantity: 0,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000)
      })
    ).rejects.toThrow();
  });

  test("rejects invalid event time ordering at the database layer", async () => {
    const { event } = await createConstraintFixture();
    const startTime = new Date("2026-08-01T10:00:00.000Z");

    await expect(
      prisma.event.update({
        where: { id: event.id },
        data: {
          startTime,
          endTime: startTime
        }
      })
    ).rejects.toThrow();

    await expect(
      prisma.event.update({
        where: { id: event.id },
        data: {
          startTime,
          endTime: new Date(startTime.getTime() - 60 * 1000)
        }
      })
    ).rejects.toThrow();
  });

  test("rejects paid orders without paidAt and expired orders with paidAt at the database layer", async () => {
    const { order } = await createConstraintFixture();

    await expect(
      prisma.order.update({
        where: { id: order.id },
        data: {
          status: "paid",
          paidAt: null
        }
      })
    ).rejects.toThrow();

    await expect(
      prisma.order.update({
        where: { id: order.id },
        data: {
          status: "expired",
          paidAt: new Date()
        }
      })
    ).rejects.toThrow();
  });
});
