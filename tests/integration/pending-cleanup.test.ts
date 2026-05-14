import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { runStaleOrderCleanup } from "@/lib/orders/stale-orders";
import { expireOldActiveReservations } from "@/lib/tickets/reservations";
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

  test("uses event ownership for organisation-scoped cleanup when denormalized ownership drifts", async () => {
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    const { organisation } = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const otherEvent = await createEvent({ organisationId: other.organisation.id });
    const ticketType = event.ticketTypes[0];
    const otherTicketType = otherEvent.ticketTypes[0];
    const old = new Date(Date.now() - 31 * 60 * 1000);

    const driftedReservationBacked = await createOrder({
      organisationId: other.organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "pending",
      unitPrice: ticketType.price
    });
    await createReservation({
      orderId: driftedReservationBacked.id,
      organisationId: other.organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      expiresAt: old
    });

    const driftedLegacy = await createOrder({
      organisationId: other.organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "pending",
      createdAt: old,
      unitPrice: ticketType.price
    });

    const crossTenant = await createOrder({
      organisationId: organisation.id,
      eventId: otherEvent.id,
      ticketTypeId: otherTicketType.id,
      userId: member.id,
      status: "pending",
      createdAt: old,
      unitPrice: otherTicketType.price
    });
    await createReservation({
      orderId: crossTenant.id,
      organisationId: organisation.id,
      eventId: otherEvent.id,
      ticketTypeId: otherTicketType.id,
      userId: member.id,
      expiresAt: old
    });

    const result = await runStaleOrderCleanup({ organisationId: organisation.id });

    expect(result.reservationsUpdated).toBe(1);
    expect(result.reservationBackedOrdersUpdated).toBe(0);
    expect(result.legacyReservationlessOrdersUpdated).toBe(1);
    expect(result.ordersUpdated).toBe(1);

    const orders = await prisma.order.findMany({
      where: {
        id: {
          in: [driftedReservationBacked.id, driftedLegacy.id, crossTenant.id]
        }
      },
      include: { reservation: true }
    });
    const byId = new Map(orders.map((order) => [order.id, order]));

    expect(byId.get(driftedReservationBacked.id)?.status).toBe("expired");
    expect(byId.get(driftedReservationBacked.id)?.organisationId).toBe(
      other.organisation.id
    );
    expect(byId.get(driftedReservationBacked.id)?.reservation?.status).toBe(
      "expired"
    );
    expect(byId.get(driftedReservationBacked.id)?.reservation?.organisationId).toBe(
      other.organisation.id
    );
    expect(byId.get(driftedLegacy.id)?.status).toBe("expired");
    expect(byId.get(driftedLegacy.id)?.organisationId).toBe(other.organisation.id);
    expect(byId.get(crossTenant.id)?.status).toBe("pending");
    expect(byId.get(crossTenant.id)?.reservation?.status).toBe("active");
  });

  test("expires active reservations by event ownership rather than denormalized reservation organisation", async () => {
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    const { organisation } = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const otherEvent = await createEvent({ organisationId: other.organisation.id });
    const ticketType = event.ticketTypes[0];
    const otherTicketType = otherEvent.ticketTypes[0];
    const old = new Date(Date.now() - 31 * 60 * 1000);

    const driftedReservationOrder = await createOrder({
      organisationId: other.organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "pending",
      unitPrice: ticketType.price
    });
    await createReservation({
      orderId: driftedReservationOrder.id,
      organisationId: other.organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      expiresAt: old
    });

    const crossTenantOrder = await createOrder({
      organisationId: organisation.id,
      eventId: otherEvent.id,
      ticketTypeId: otherTicketType.id,
      userId: member.id,
      status: "pending",
      unitPrice: otherTicketType.price
    });
    await createReservation({
      orderId: crossTenantOrder.id,
      organisationId: organisation.id,
      eventId: otherEvent.id,
      ticketTypeId: otherTicketType.id,
      userId: member.id,
      expiresAt: old
    });

    const result = await prisma.$transaction((tx) =>
      expireOldActiveReservations(tx, {
        now: new Date(),
        organisationId: organisation.id
      })
    );

    expect(result.count).toBe(1);

    const orders = await prisma.order.findMany({
      where: {
        id: {
          in: [driftedReservationOrder.id, crossTenantOrder.id]
        }
      },
      include: { reservation: true }
    });
    const byId = new Map(orders.map((order) => [order.id, order]));

    expect(byId.get(driftedReservationOrder.id)?.status).toBe("expired");
    expect(byId.get(driftedReservationOrder.id)?.reservation?.status).toBe(
      "expired"
    );
    expect(byId.get(driftedReservationOrder.id)?.reservation?.organisationId).toBe(
      other.organisation.id
    );
    expect(byId.get(crossTenantOrder.id)?.status).toBe("pending");
    expect(byId.get(crossTenantOrder.id)?.reservation?.status).toBe("active");
    expect(byId.get(crossTenantOrder.id)?.reservation?.organisationId).toBe(
      organisation.id
    );
  });
});
