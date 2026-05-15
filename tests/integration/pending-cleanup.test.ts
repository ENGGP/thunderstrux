import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  parseStaleOrderCleanupCliOptions,
  processStaleOrderCleanupBatch,
  runStaleOrderCleanup
} from "@/lib/orders/stale-orders";
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

  test("worker expires stale reservations and old legacy pending orders in a bounded batch", async () => {
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const old = new Date(Date.now() - 31 * 60 * 1000);

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

    const legacy = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "pending",
      createdAt: old,
      unitPrice: ticketType.price
    });
    const alreadyExpiredReservationOrder = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "pending",
      unitPrice: ticketType.price
    });
    await createReservation({
      orderId: alreadyExpiredReservationOrder.id,
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "expired",
      expiresAt: old,
      releasedAt: old,
      releaseReason: "expired before worker"
    });
    const alreadyExpiredOrder = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "expired",
      failureReason: "already_expired",
      unitPrice: ticketType.price
    });

    const first = await processStaleOrderCleanupBatch({ limit: 3 });
    const second = await processStaleOrderCleanupBatch({ limit: 3 });

    expect(first).toMatchObject({
      dryRun: false,
      limit: 3,
      reservationsSelected: 1,
      reservationsExpired: 1,
      reservationBackedOrdersExpired: 1,
      alreadyExpiredReservationBackedOrdersSelected: 1,
      alreadyExpiredReservationBackedOrdersExpired: 1,
      legacyOrdersSelected: 1,
      legacyOrdersExpired: 1,
      ordersExpired: 3
    });
    expect(second.ordersExpired).toBe(0);

    const orders = await prisma.order.findMany({
      where: {
        id: {
          in: [
            reservationBacked.id,
            alreadyExpiredReservationOrder.id,
            legacy.id,
            alreadyExpiredOrder.id
          ]
        }
      },
      include: { reservation: true }
    });
    const byId = new Map(orders.map((order) => [order.id, order]));

    expect(byId.get(reservationBacked.id)?.status).toBe("expired");
    expect(byId.get(reservationBacked.id)?.reservation?.status).toBe("expired");
    expect(byId.get(alreadyExpiredReservationOrder.id)?.status).toBe("expired");
    expect(byId.get(alreadyExpiredReservationOrder.id)?.reservation?.status).toBe(
      "expired"
    );
    expect(byId.get(legacy.id)?.status).toBe("expired");
    expect(byId.get(alreadyExpiredOrder.id)?.status).toBe("expired");
    expect(byId.get(alreadyExpiredOrder.id)?.failureReason).toBe(
      "already_expired"
    );
  });

  test("worker dry-run is read-only and terminal states are preserved", async () => {
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const old = new Date(Date.now() - 31 * 60 * 1000);

    const pending = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "pending",
      unitPrice: ticketType.price
    });
    await createReservation({
      orderId: pending.id,
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      expiresAt: old
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
    const compensation = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "failed",
      paidAt: new Date(),
      failedAt: new Date(),
      failureReason: "inventory_unavailable_after_payment",
      requiresCompensationReview: true,
      fulfilmentFailedAt: new Date(),
      fulfilmentFailureReason: "inventory_unavailable_after_payment",
      unitPrice: ticketType.price
    });

    const dryRun = await processStaleOrderCleanupBatch({ limit: 10, dryRun: true });
    expect(dryRun).toMatchObject({
      dryRun: true,
      reservationsSelected: 1,
      reservationsExpired: 0,
      ordersExpired: 0
    });

    const afterDryRun = await prisma.order.findMany({
      where: { id: { in: [pending.id, paid.id, compensation.id] } },
      include: { reservation: true }
    });
    const byId = new Map(afterDryRun.map((order) => [order.id, order]));

    expect(byId.get(pending.id)?.status).toBe("pending");
    expect(byId.get(pending.id)?.reservation?.status).toBe("active");
    expect(byId.get(paid.id)?.status).toBe("paid");
    expect(byId.get(paid.id)?.reservation?.status).toBe("confirmed");
    expect(byId.get(compensation.id)?.status).toBe("failed");
    expect(byId.get(compensation.id)?.requiresCompensationReview).toBe(true);
  });

  test("overlapping worker runs leave persisted cleanup state correct", async () => {
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const old = new Date(Date.now() - 31 * 60 * 1000);
    const orders = [];

    for (let index = 0; index < 3; index += 1) {
      const order = await createOrder({
        organisationId: organisation.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        userId: member.id,
        status: "pending",
        unitPrice: ticketType.price
      });
      await createReservation({
        orderId: order.id,
        organisationId: organisation.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        userId: member.id,
        expiresAt: old
      });
      orders.push(order);
    }

    await Promise.all([
      processStaleOrderCleanupBatch({ limit: 3 }),
      processStaleOrderCleanupBatch({ limit: 3 })
    ]);

    const persisted = await prisma.order.findMany({
      where: { id: { in: orders.map((order) => order.id) } },
      include: { reservation: true }
    });

    expect(persisted).toHaveLength(3);
    expect(persisted.every((order) => order.status === "expired")).toBe(true);
    expect(
      persisted.every((order) => order.reservation?.status === "expired")
    ).toBe(true);
  });

  test("worker parser accepts dry-run and limit and rejects invalid limits", () => {
    expect(parseStaleOrderCleanupCliOptions(["--dry-run", "--limit=25"])).toEqual({
      dryRun: true,
      limit: 25
    });
    expect(() => parseStaleOrderCleanupCliOptions(["--limit=0"])).toThrow(
      "--limit must be an integer between 1 and 1000."
    );
    expect(() => parseStaleOrderCleanupCliOptions(["--unknown"])).toThrow(
      "Unknown stale cleanup option"
    );
  });
});
