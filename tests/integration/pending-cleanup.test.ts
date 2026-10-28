import { describe, expect, test, vi } from "vitest";
import DashboardPage from "@/app/(dashboard)/dashboard/page";
import OrganisationOrdersPage from "@/app/(dashboard)/dashboard/orders/page";
import { GET as getOrderDetail } from "@/app/api/orders/[orderId]/route";
import { GET as getOrders } from "@/app/api/orders/route";
import { GET as getPublicEvent } from "@/app/api/public/events/[eventId]/route";
import MyTicketsPage from "@/app/tickets/page";
import { eventTicketTypeMetrics, ticketMetrics } from "@/lib/analytics/metrics";
import { prisma } from "@/lib/db";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, routeContext } from "@/tests/helpers/http";
import { renderPage } from "@/tests/helpers/render";
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

// The dashboard and personal shells read the pathname.
// PAY-024: cleanup asks Stripe before expiring an order with a Session; these
// fixtures' Sessions were never created there, so Stripe has no record of them.
vi.mock("@/lib/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe")>()),
  getStripe: () => ({
    checkout: { sessions: { retrieve: async () => Promise.reject(Object.assign(new Error("No such checkout.session"), { code: "resource_missing" })) } }
  })
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/dashboard/orders",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));

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

  // Only the job expires an order; every page and API shows a stale one as it stands.
  test("no page or API that reads a stale pending order expires it or releases its hold", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id, status: "published" });
    const ticketType = event.ticketTypes[0];
    const pending = await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId: ticketType.id, userId: member.id, status: "pending", unitPrice: ticketType.price });
    await createReservation({ orderId: pending.id, organisationId: organisation.id, eventId: event.id, ticketTypeId: ticketType.id, userId: member.id, expiresAt: new Date(Date.now() - 60 * 1000) });
    const state = () => prisma.order.findUniqueOrThrow({ where: { id: pending.id }, select: { status: true, failureReason: true, reservation: { select: { status: true, releasedAt: true } } } });
    const before = await state();
    expect(before).toMatchObject({ status: "pending", reservation: { status: "active", releasedAt: null } });

    expect((await getPublicEvent(new Request(`http://localhost/api/public/events/${event.id}`), routeContext({ eventId: event.id }))).status).toBe(200);
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    expect(await renderPage(await MyTicketsPage({ searchParams: Promise.resolve({}) }))).not.toContain(pending.id);

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    expect(JSON.stringify(await (await getOrders(jsonRequest("http://localhost/api/orders?includeSystem=true&status=pending"))).json())).toContain(pending.id);
    // Shown with its buyer, but order detail serves settled orders only.
    expect((await getOrderDetail(jsonRequest(`http://localhost/api/orders/${pending.id}`), routeContext({ orderId: pending.id }))).status).toBe(404);
    const ordersPage = await renderPage(await OrganisationOrdersPage({ searchParams: Promise.resolve({ includeSystem: "true", status: "pending" }) }));
    expect(ordersPage).toContain(member.email);
    expect(ordersPage).not.toContain(`/dashboard/orders/${pending.id}`);
    const landing = await renderPage(await DashboardPage());
    expect(landing).toContain("Recent orders");
    expect(landing).not.toContain(`/dashboard/orders/${pending.id}`);
    await eventTicketTypeMetrics(organisation.id, event.id, { financial: true });
    await ticketMetrics(organisation.id, { from: "2026-05-01", to: "2026-05-31", bucket: "day", timeZone: "Australia/Brisbane" }, { financial: true }, event.id);

    expect(await state()).toEqual(before);
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
