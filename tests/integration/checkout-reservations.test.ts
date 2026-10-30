import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse } from "@/tests/helpers/http";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount,
  createReservation,
  unique
} from "@/tests/helpers/test-data";
import { getActiveReservedQuantity } from "@/lib/tickets/reservations";
import { processStaleOrderCleanupBatch } from "@/lib/orders/stale-orders";
import { createEventCheckout } from "@/lib/payments/checkout-creation";
import { reconcileCompletedCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import { checkoutSession } from "@/tests/helpers/stripe-mocks";

const stripeMocks = vi.hoisted(() => ({
  createSession: vi.fn()
}));

function parseConsoleJson(spy: ReturnType<typeof vi.spyOn>, index = 0) {
  const message = spy.mock.calls[index]?.[0];

  if (typeof message !== "string") {
    throw new Error("Expected structured log string");
  }

  return JSON.parse(message) as Record<string, unknown>;
}

vi.mock("@/lib/stripe", () => {
  class StripeConfigurationError extends Error {}

  return {
    StripeConfigurationError,
    getAppUrl: () => "http://localhost:3000",
    getStripe: () => ({
      checkout: {
        sessions: {
          create: stripeMocks.createSession
        }
      }
    })
  };
});

describe("checkout and reservation logic", () => {
  test("checkout requires member account and denies organisation accounts", async () => {
    const { user, organisation } = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published"
    });
    const { POST } = await import("@/app/api/payments/checkout/event/route");

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const response = await POST(
      jsonRequest("http://localhost/api/payments/checkout/event", {
        eventId: event.id,
        ticketTypeId: event.ticketTypes[0].id,
        expectedUnitPrice: event.ticketTypes[0].price,
        idempotencyKey: unique("checkout"),
        quantity: 1
      })
    );

    expect(response.status).toBe(400);
    expect(await parseJsonResponse(response)).toMatchObject({
      error: { code: "BAD_REQUEST", message: expect.any(String) }
    });
    await expect(prisma.order.count()).resolves.toBe(0);
  });

  test("Stripe-not-ready checkout creates no order or reservation", async () => {
    const { organisation } = await createOrganisationAccount({ stripeReady: false });
    const member = await createMember();
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published"
    });
    const { POST } = await import("@/app/api/payments/checkout/event/route");

    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    const response = await POST(
      jsonRequest("http://localhost/api/payments/checkout/event", {
        eventId: event.id,
        ticketTypeId: event.ticketTypes[0].id,
        expectedUnitPrice: event.ticketTypes[0].price,
        idempotencyKey: unique("checkout"),
        quantity: 1
      })
    );

    expect(response.status).toBe(400);
    expect(await parseJsonResponse(response)).toMatchObject({
      error: { code: "BAD_REQUEST", message: expect.stringContaining("Stripe") }
    });
    await expect(prisma.order.count()).resolves.toBe(0);
    await expect(prisma.ticketReservation.count()).resolves.toBe(0);
    expect(stripeMocks.createSession).not.toHaveBeenCalled();
  });

  test("successful mocked checkout creates pending order and active reservation", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.setSystemTime(new Date("2026-05-01T10:00:00.000Z"));
    stripeMocks.createSession.mockResolvedValueOnce({
      id: "cs_integration_success",
      url: "https://checkout.stripe.test/session"
    });
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const member = await createMember();
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published",
      ticketTypes: [{ name: "General", price: 2500, quantity: 10 }]
    });
    const { POST } = await import("@/app/api/payments/checkout/event/route");

    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    const response = await POST(
      jsonRequest("http://localhost/api/payments/checkout/event", {
        eventId: event.id,
        ticketTypeId: event.ticketTypes[0].id,
        expectedUnitPrice: event.ticketTypes[0].price,
        idempotencyKey: unique("checkout"),
        quantity: 2
      })
    );

    expect(response.status).toBe(200);
    expect(await parseJsonResponse(response)).toEqual({
      kind: "stripe",
      url: "https://checkout.stripe.test/session"
    });
    const order = await prisma.order.findFirstOrThrow({
      include: { reservation: true, lifecycleEvents: { orderBy: { sequence: "asc" } } }
    });
    expect(order).toMatchObject({
      organisationId: event.organisationId,
      status: "pending",
      quantity: 2,
      unitPrice: 2500,
      totalAmount: 5000,
      stripeSessionId: "cs_integration_success"
    });
    expect(order.reservation).toMatchObject({
      organisationId: event.organisationId,
      status: "active",
      quantity: 2
    });
    expect(order.lifecycleEvents).toEqual([
      expect.objectContaining({
        sequence: 1,
        type: "order_created",
        source: "checkout",
        toOrderStatus: "pending",
        toReservationStatus: "active"
      }),
      expect.objectContaining({
        sequence: 2,
        type: "stripe_session_attached",
        source: "checkout",
        stripeSessionId: "cs_integration_success"
      })
    ]);

    // Stripe's page: 30 minutes (Stripe refuses shorter) plus the margin for the trip there.
    const expectedExpiresAtSeconds =
      Math.ceil(new Date("2026-05-01T10:00:00.000Z").getTime() / 1000) + 30 * 60 + 60;
    // The seats: the event's 20-minute hold plus 5 minutes for a late webhook (PAY-009, DEF-033).
    expect(order.reservation?.expiresAt.toISOString()).toBe("2026-05-01T10:25:00.000Z");
    expect(stripeMocks.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        expires_at: expectedExpiresAtSeconds,
        // Stripe's page can't count down, so it names when the hold ends (10:20 UTC is 8:20 pm in Brisbane).
        custom_text: { submit: { message: "We're holding your tickets until 8:20 pm Brisbane time. After that they go back on sale." } },
        customer_email: expect.stringContaining("@"),
        integration_identifier: "thunderstrux-tickets-qhzmvkra",
        metadata: expect.objectContaining({
          orderId: order.id,
          eventId: event.id,
          organisationId: event.organisationId,
          ticketTypeId: event.ticketTypes[0].id,
          quantity: "2"
        })
      }),
      { idempotencyKey: expect.stringMatching(/^checkout_/) }
    );
    expect(info.mock.calls.map((call) => JSON.parse(String(call[0])))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "checkout.session.create_started",
          eventId: event.id,
          organisationId: event.organisationId,
          ticketTypeId: event.ticketTypes[0].id,
          quantity: 2,
          totalAmount: 5000
        }),
        expect.objectContaining({
          event: "checkout.session.created",
          orderId: order.id,
          stripeSessionId: "cs_integration_success",
          eventId: event.id,
          organisationId: event.organisationId,
          ticketTypeId: event.ticketTypes[0].id
        })
      ])
    );
  });

  test("active reservations reduce availability and expired reservations do not", async () => {
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const member = await createMember();
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published",
      ticketTypes: [{ name: "General", price: 1000, quantity: 5 }]
    });
    const ticketType = event.ticketTypes[0];

    const activeOrder = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      quantity: 2,
      unitPrice: ticketType.price
    });
    await createReservation({
      orderId: activeOrder.id,
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      quantity: 2,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });
    const expiredOrder = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      quantity: 1,
      unitPrice: ticketType.price
    });
    await createReservation({
      orderId: expiredOrder.id,
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      quantity: 1,
      status: "expired",
      expiresAt: new Date(Date.now() - 60 * 1000)
    });

    const reserved = await prisma.$transaction((tx) =>
      getActiveReservedQuantity(tx, ticketType.id)
    );
    expect(reserved).toBe(2);
    expect(ticketType.quantity - reserved).toBe(3);
  });

  test("a definite Stripe refusal fails the order, its attempt and the reservation", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    stripeMocks.createSession.mockRejectedValueOnce(Object.assign(new Error("stripe unavailable"), { type: "StripeInvalidRequestError" }));
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const member = await createMember();
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published"
    });
    const { POST } = await import("@/app/api/payments/checkout/event/route");

    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    const response = await POST(
      jsonRequest("http://localhost/api/payments/checkout/event", {
        eventId: event.id,
        ticketTypeId: event.ticketTypes[0].id,
        expectedUnitPrice: event.ticketTypes[0].price,
        idempotencyKey: unique("checkout"),
        quantity: 1
      })
    );

    expect(response.status).toBe(500);
    const order = await prisma.order.findFirstOrThrow({
      include: { reservation: true, lifecycleEvents: { orderBy: { sequence: "asc" } } }
    });
    expect(order.status).toBe("failed");
    expect(order.failureReason).toBe("stripe_error");
    expect(order.reservation?.status).toBe("released");
    expect(order.lifecycleEvents.map((event) => event.type)).toEqual([
      "order_created",
      "order_failed"
    ]);
    await expect(prisma.checkoutAttempt.findUniqueOrThrow({ where: { orderId: order.id } })).resolves.toMatchObject({
      state: "failed",
      reconcileDueAt: null
    });

    expect(parseConsoleJson(error, 0)).toMatchObject({
      level: "error",
      event: "checkout.session.create_failed",
      reason: "stripe_error",
      eventId: event.id,
      ticketTypeId: event.ticketTypes[0].id,
      quantity: 1,
      error: {
        name: "Error",
        message: "stripe unavailable"
      }
    });
    expect(parseConsoleJson(error, 1)).toMatchObject({
      level: "error",
      event: "checkout_session_creation_failure",
      reason: "stripe_error",
      eventId: event.id,
      ticketTypeId: event.ticketTypes[0].id,
      quantity: 1
    });
    expect(info.mock.calls.map((call) => JSON.parse(String(call[0])))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "info",
          event: "ops.metric",
          metricName: "checkout_session_create_failures_total",
          tags: {
            reason: "stripe_error"
          }
        })
      ])
    );
  });

  // DEF-033: Stripe takes no payment after its page closes, but the webhook comes later.
  test("a payment made just before Stripe closes the page still gets its tickets; past the grace it does while seats are free, else it goes to review (PAY-031)", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.setSystemTime(new Date("2026-05-01T10:00:00.000Z"));
    stripeMocks.createSession
      .mockResolvedValueOnce({ id: "cs_paid_in_time", url: "https://checkout.stripe.test/in-time" })
      .mockResolvedValueOnce({ id: "cs_paid_late_free", url: "https://checkout.stripe.test/late-free" })
      .mockResolvedValueOnce({ id: "cs_paid_late_full", url: "https://checkout.stripe.test/late-full" });
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({ organisationId: organisation.id, status: "published", ticketTypes: [{ name: "General", price: 1000, quantity: 5 }] });
    const ticketTypeId = event.ticketTypes[0].id;
    for (const member of [await createMember(), await createMember(), await createMember()]) {
      await createEventCheckout({ userId: member.id, eventId: event.id, ticketTypeId, quantity: 1, expectedUnitPrice: 1000, idempotencyKey: unique("checkout") });
    }
    const paid = async (stripeSessionId: string) => {
      const order = await prisma.order.findUniqueOrThrow({ where: { stripeSessionId } });
      return reconcileCompletedCheckoutSession(checkoutSession({
        id: stripeSessionId, orderId: order.id, eventId: event.id, organisationId: organisation.id, ticketTypeId, quantity: 1, amountTotal: 1000
      }));
    };

    // The holds ended at 10:20 and Stripe's pages close at 10:31; the job can't ask
    // Stripe here, so the seats wait out the margin. This webhook lands at 10:33.
    vi.setSystemTime(new Date("2026-05-01T10:33:00.000Z"));
    await processStaleOrderCleanupBatch();
    expect(await paid("cs_paid_in_time")).toMatchObject({ status: "fulfilled" });

    // Past the 5-minute grace the hold has lapsed, but the order is still pending
    // (the job couldn't ask Stripe) and seats are free: the tickets are issued.
    vi.setSystemTime(new Date("2026-05-01T10:37:00.000Z"));
    await processStaleOrderCleanupBatch();
    expect(await paid("cs_paid_late_free")).toMatchObject({ status: "fulfilled" });
    expect(await prisma.ticket.count({ where: { order: { stripeSessionId: "cs_paid_late_free" } } })).toBe(1);

    // With no seat left, a late payment goes to review.
    await prisma.ticketType.update({ where: { id: ticketTypeId }, data: { quantity: 0 } });
    expect(await paid("cs_paid_late_full")).toMatchObject({ status: "compensation_required" });
  });

  test("one buyer's unpaid holds on an event stay within one order's worth (SEC-005)", async () => {
    stripeMocks.createSession.mockImplementation(async () => ({ id: unique("cs_cap"), url: "https://checkout.stripe.test/session" }));
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({ organisationId: organisation.id, status: "published", ticketTypes: [{ name: "General", price: 1000, quantity: 50 }] });
    const ticketTypeId = event.ticketTypes[0].id;
    const member = await createMember();
    const other = await createMember();
    const checkout = (userId: string, quantity: number) =>
      createEventCheckout({ userId, eventId: event.id, ticketTypeId, quantity, expectedUnitPrice: 1000, idempotencyKey: unique("checkout") });

    await checkout(member.id, 6);
    await expect(checkout(member.id, 5)).rejects.toMatchObject({ kind: "purchase_in_progress" });
    await checkout(member.id, 4);
    await expect(checkout(member.id, 1)).rejects.toMatchObject({ kind: "purchase_in_progress" });
    // Other buyers are unaffected.
    await checkout(other.id, 10);
    // A hold that ended (cancelled, failed or lapsed) no longer counts.
    await prisma.ticketReservation.updateMany({ where: { userId: member.id }, data: { status: "released", releasedAt: new Date() } });
    await checkout(member.id, 10);
    await expect(prisma.ticketReservation.count({ where: { status: "active" } })).resolves.toBe(2);
    stripeMocks.createSession.mockReset();
  });
});
