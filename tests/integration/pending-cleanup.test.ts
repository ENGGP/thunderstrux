import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { runStaleOrderCleanup } from "@/lib/orders/stale-orders";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount,
  createReservation
} from "@/tests/helpers/test-data";

describe("pending order cleanup", () => {
  test("expires reservation-backed and old legacy pending orders only", async () => {
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const old = new Date(Date.now() - 31 * 60 * 1000);
    const future = new Date(Date.now() + 30 * 60 * 1000);

    const reservationBacked = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "pending",
      unitPrice: ticketType.price
    });
    await createReservation({
      orderId: reservationBacked.id,
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      expiresAt: old
    });

    const oldLegacy = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "pending",
      createdAt: old,
      unitPrice: ticketType.price
    });
    const freshLegacy = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "pending",
      unitPrice: ticketType.price
    });
    const paid = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "paid",
      paidAt: new Date(),
      unitPrice: ticketType.price
    });
    await createReservation({
      orderId: paid.id,
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "confirmed",
      confirmedAt: new Date(),
      expiresAt: old
    });
    const failed = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "failed",
      failedAt: new Date(),
      failureReason: "already_failed",
      unitPrice: ticketType.price
    });
    await createReservation({
      orderId: failed.id,
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "released",
      releasedAt: new Date(),
      releaseReason: "already failed",
      expiresAt: future
    });

    const first = await runStaleOrderCleanup({ organisationId: organisation.id });
    const second = await runStaleOrderCleanup({ organisationId: organisation.id });
    expect(first.reservationsUpdated).toBe(1);
    expect(first.ordersUpdated).toBe(1);
    expect(second.ordersUpdated).toBe(0);

    const orders = await prisma.order.findMany({
      where: {
        id: {
          in: [reservationBacked.id, oldLegacy.id, freshLegacy.id, paid.id, failed.id]
        }
      },
      include: { reservation: true },
      orderBy: { id: "asc" }
    });
    const byId = new Map(orders.map((order) => [order.id, order]));

    expect(byId.get(reservationBacked.id)?.status).toBe("expired");
    expect(byId.get(reservationBacked.id)?.reservation?.status).toBe("expired");
    expect(byId.get(oldLegacy.id)?.status).toBe("expired");
    expect(byId.get(freshLegacy.id)?.status).toBe("pending");
    expect(byId.get(paid.id)?.status).toBe("paid");
    expect(byId.get(paid.id)?.reservation?.status).toBe("confirmed");
    expect(byId.get(failed.id)?.status).toBe("failed");
    expect(byId.get(failed.id)?.failureReason).toBe("already_failed");
  });
});
