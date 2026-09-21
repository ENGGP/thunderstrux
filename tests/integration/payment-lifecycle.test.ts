import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { isTransactionConflict } from "@/lib/transaction-conflict";
import {
  markOrganisationOrderManuallyRefunded,
  OrganisationOrderAccessError
} from "@/lib/orders/order-detail";
import {
  getOrganisationOrderLifecycle,
  parseOrderLifecycleCursor
} from "@/lib/payments/order-lifecycle-history";
import {
  reconcileCompletedCheckoutSession,
  reconcileExpiredCheckoutSession
} from "@/lib/payments/checkout-reconciliation";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount,
  createReservation
} from "@/tests/helpers/test-data";
import { checkoutSession } from "@/tests/helpers/stripe-mocks";

async function paymentFixture(sessionId: string) {
  const { organisation } = await createOrganisationAccount({ stripeReady: true });
  const member = await createMember();
  const event = await createEvent({
    organisationId: organisation.id,
    status: "published",
    ticketTypes: [{ name: "General", price: 1500, quantity: 5 }]
  });
  const ticketType = event.ticketTypes[0];
  const order = await createOrder({
    organisationId: organisation.id,
    eventId: event.id,
    ticketTypeId: ticketType.id,
    userId: member.id,
    unitPrice: ticketType.price,
    stripeSessionId: sessionId
  });

  return { organisation, member, event, ticketType, order };
}

describe("formal payment lifecycle", () => {
  test("retries only recognized transaction conflicts", () => {
    for (const error of [
      { code: "P2034" },
      { code: "P2010", meta: { code: "40001" } },
      { code: "P2010", meta: { code: "40P01" } }
    ]) expect(isTransactionConflict(error)).toBe(true);
    for (const error of [
      null, new Error("40001"), { code: "P2002" },
      { code: "P2010" }, { code: "P2010", meta: null },
      { code: "P2010", meta: { code: "23505" } }
    ]) expect(isTransactionConflict(error)).toBe(false);
  });

  test("concurrent paid replays fulfil and journal exactly once", async () => {
    const fixture = await paymentFixture("cs_lifecycle_concurrent");
    await createReservation({
      orderId: fixture.order.id,
      organisationId: fixture.organisation.id,
      eventId: fixture.event.id,
      ticketTypeId: fixture.ticketType.id,
      userId: fixture.member.id,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    });
    const session = checkoutSession({
      id: "cs_lifecycle_concurrent",
      orderId: fixture.order.id,
      eventId: fixture.event.id,
      organisationId: fixture.organisation.id,
      ticketTypeId: fixture.ticketType.id,
      quantity: 1,
      amountTotal: fixture.ticketType.price
    });
    const results = await Promise.all([
      reconcileCompletedCheckoutSession(session),
      reconcileCompletedCheckoutSession(session)
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "already_paid",
      "fulfilled"
    ]);
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
      include: { tickets: true, emailOutboxJobs: true, lifecycleEvents: true }
    });
    expect(order.tickets).toHaveLength(1);
    expect(order.emailOutboxJobs).toHaveLength(1);
    expect(order.lifecycleEvents).toHaveLength(3);
    await expect(prisma.ticketType.findUniqueOrThrow({
      where: { id: fixture.ticketType.id }
    })).resolves.toMatchObject({ quantity: 4 });
  });

  test("records an ordered, idempotent fulfilment history without sensitive facts", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fixture = await paymentFixture("cs_lifecycle_paid");
    await createReservation({
      orderId: fixture.order.id,
      organisationId: fixture.organisation.id,
      eventId: fixture.event.id,
      ticketTypeId: fixture.ticketType.id,
      userId: fixture.member.id,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    });
    const session = checkoutSession({
      id: "cs_lifecycle_paid",
      orderId: fixture.order.id,
      eventId: fixture.event.id,
      organisationId: fixture.organisation.id,
      ticketTypeId: fixture.ticketType.id,
      quantity: 1,
      amountTotal: fixture.ticketType.price
    });

    await reconcileCompletedCheckoutSession(session, { stripeEventId: "evt_lifecycle" });
    await reconcileCompletedCheckoutSession(session, {
      stripeEventId: "evt_lifecycle_duplicate"
    });

    const events = await prisma.orderLifecycleEvent.findMany({
      where: { orderId: fixture.order.id },
      orderBy: { sequence: "asc" }
    });
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(events.map((event) => event.type)).toEqual([
      "legacy_baseline",
      "payment_fulfilled",
      "email_enqueued"
    ]);
    expect(events[1]).toMatchObject({
      source: "stripe_webhook",
      stripeEventId: "evt_lifecycle",
      stripeSessionId: "cs_lifecycle_paid",
      fromOrderStatus: "pending",
      toOrderStatus: "paid"
    });
    expect(JSON.stringify(events.map((event) => event.facts))).not.toMatch(
      /@example\.com|sk_test|password/i
    );
  });

  test("rejects ambiguous Stripe order identity without mutating either order", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await paymentFixture("cs_metadata_order");
    const sessionOrder = await createOrder({
      organisationId: fixture.organisation.id,
      eventId: fixture.event.id,
      ticketTypeId: fixture.ticketType.id,
      userId: fixture.member.id,
      unitPrice: fixture.ticketType.price,
      stripeSessionId: "cs_ambiguous"
    });

    const result = await reconcileCompletedCheckoutSession(
      checkoutSession({
        id: "cs_ambiguous",
        orderId: fixture.order.id,
        eventId: fixture.event.id,
        organisationId: fixture.organisation.id,
        ticketTypeId: fixture.ticketType.id,
        quantity: 1,
        amountTotal: fixture.ticketType.price
      })
    );

    expect(result).toEqual({ status: "ignored", reason: "ambiguous_order_match" });
    await expect(
      prisma.order.count({
        where: { id: { in: [fixture.order.id, sessionOrder.id] }, status: "pending" }
      })
    ).resolves.toBe(2);
    await expect(
      prisma.orderLifecycleEvent.count({
        where: { orderId: { in: [fixture.order.id, sessionOrder.id] } }
      })
    ).resolves.toBe(0);
    expect(error).toHaveBeenCalled();
  });

  test("rejects ambiguous expired-session identity without expiring either order", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await paymentFixture("cs_expiry_metadata_order");
    const sessionOrder = await createOrder({
      organisationId: fixture.organisation.id,
      eventId: fixture.event.id,
      ticketTypeId: fixture.ticketType.id,
      userId: fixture.member.id,
      unitPrice: fixture.ticketType.price,
      stripeSessionId: "cs_expiry_ambiguous"
    });

    const result = await reconcileExpiredCheckoutSession(
      checkoutSession({
        id: "cs_expiry_ambiguous",
        orderId: fixture.order.id,
        paymentStatus: "unpaid"
      })
    );

    expect(result).toEqual({ status: "ignored", reason: "ambiguous_order_match" });
    await expect(
      prisma.order.count({
        where: { id: { in: [fixture.order.id, sessionOrder.id] }, status: "pending" }
      })
    ).resolves.toBe(2);
  });

  test("turns a late paid session for an ordinary failed order into durable compensation", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await paymentFixture("cs_late_paid");
    await prisma.order.update({
      where: { id: fixture.order.id },
      data: {
        status: "failed",
        failedAt: new Date(),
        failureReason: "checkout_creation_failed"
      }
    });
    await createReservation({
      orderId: fixture.order.id,
      organisationId: fixture.organisation.id,
      eventId: fixture.event.id,
      ticketTypeId: fixture.ticketType.id,
      userId: fixture.member.id,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    });

    const result = await reconcileCompletedCheckoutSession(
      checkoutSession({
        id: "cs_late_paid",
        orderId: fixture.order.id,
        eventId: fixture.event.id,
        organisationId: fixture.organisation.id,
        ticketTypeId: fixture.ticketType.id,
        quantity: 1,
        amountTotal: fixture.ticketType.price
      }),
      { stripeEventId: "evt_late_paid" }
    );

    expect(result).toEqual({
      status: "compensation_required",
      orderId: fixture.order.id,
      reason: "paid_session_received_after_order_failed"
    });
    await expect(
      prisma.order.findUniqueOrThrow({
        where: { id: fixture.order.id },
        include: { reservation: true, lifecycleEvents: true }
      })
    ).resolves.toMatchObject({
      status: "failed",
      requiresCompensationReview: true,
      reservation: { status: "released" },
      lifecycleEvents: expect.arrayContaining([
        expect.objectContaining({
          type: "compensation_required",
          reason: "paid_session_received_after_order_failed"
        })
      ])
    });
  });

  test("attributes staff actions, isolates tenant history, and blocks refunded recovery", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fixture = await paymentFixture("cs_refunded_compensation");
    const other = await createOrganisationAccount();
    await prisma.order.update({
      where: { id: fixture.order.id },
      data: {
        status: "failed",
        failedAt: new Date(),
        failureReason: "inventory_unavailable_after_payment",
        paidAt: new Date(),
        requiresCompensationReview: true,
        fulfilmentFailedAt: new Date(),
        fulfilmentFailureReason: "inventory_unavailable_after_payment"
      }
    });
    await createReservation({
      orderId: fixture.order.id,
      organisationId: fixture.organisation.id,
      eventId: fixture.event.id,
      ticketTypeId: fixture.ticketType.id,
      userId: fixture.member.id,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    });
    await markOrganisationOrderManuallyRefunded(
      fixture.organisation.id,
      fixture.order.id,
      fixture.member.id
    );

    const result = await reconcileCompletedCheckoutSession(
      checkoutSession({
        id: "cs_refunded_compensation",
        orderId: fixture.order.id,
        eventId: fixture.event.id,
        organisationId: fixture.organisation.id,
        ticketTypeId: fixture.ticketType.id,
        quantity: 1,
        amountTotal: fixture.ticketType.price
      })
    );
    const history = await getOrganisationOrderLifecycle(
      fixture.organisation.id,
      fixture.order.id
    );

    expect(result.status).toBe("compensation_required");
    expect(history.historyIncomplete).toBe(true);
    expect(history.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "manual_refund_marked",
          actorName: "Test Member"
        })
      ])
    );
    await expect(
      getOrganisationOrderLifecycle(other.organisation.id, fixture.order.id)
    ).rejects.toBeInstanceOf(OrganisationOrderAccessError);
    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })
    ).resolves.toMatchObject({
      status: "failed",
      isManuallyRefunded: true,
      requiresCompensationReview: true
    });
    expect(parseOrderLifecycleCursor("12", "newer")).toEqual({
      cursor: 12,
      direction: "newer"
    });
    expect(parseOrderLifecycleCursor("not-a-cursor", "older")).toEqual({
      direction: "older"
    });
    expect(parseOrderLifecycleCursor(undefined, "newer")).toEqual({
      direction: "older"
    });
  });
});
