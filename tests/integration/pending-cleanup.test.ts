import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  parseStaleOrderCleanupCliOptions,
  processStaleOrderCleanupBatch
} from "@/lib/orders/stale-orders";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount,
  createReservation
} from "@/tests/helpers/test-data";

function parseConsoleEntries(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.map(
    (call: unknown[]) => JSON.parse(String(call[0])) as Record<string, unknown>
  );
}

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

    const first = await processStaleOrderCleanupBatch();
    const second = await processStaleOrderCleanupBatch();
    expect(first).toMatchObject({ reservationsExpired: 1, legacyOrdersExpired: 1, ordersExpired: 2 });
    expect(second.ordersExpired).toBe(0);

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

  test("worker expires stale reservations and old legacy pending orders in a bounded batch", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
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
    expect(parseConsoleEntries(info)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "stale_orders.batch.processed",
          dryRun: false,
          reservationsExpired: 1,
          ordersExpired: 3
        }),
        expect.objectContaining({
          event: "ops.metric",
          metricName: "stale_orders_expired_total",
          metricValue: 3,
          tags: { dryRun: false }
        })
      ])
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

  test("worker failure emits structured failure event and alert", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(processStaleOrderCleanupBatch({ limit: 0 })).rejects.toThrow(
      "Stale cleanup limit must be an integer between 1 and 1000."
    );

    expect(parseConsoleEntries(error)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "stale_orders.batch.failed",
          dryRun: false,
          limit: 0,
          error: {
            name: "Error",
            message: "Stale cleanup limit must be an integer between 1 and 1000."
          }
        }),
        expect.objectContaining({
          event: "stale_order_worker_failed",
          dryRun: false,
          limit: 0,
          error: {
            name: "Error",
            message: "Stale cleanup limit must be an integer between 1 and 1000."
          }
        })
      ])
    );
  });
});
