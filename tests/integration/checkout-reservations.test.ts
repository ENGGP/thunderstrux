import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse } from "@/tests/helpers/http";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount,
  createReservation
} from "@/tests/helpers/test-data";
import { getActiveReservedQuantity } from "@/lib/tickets/reservations";

const stripeMocks = vi.hoisted(() => ({
  createSession: vi.fn()
}));

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
        quantity: 2
      })
    );

    expect(response.status).toBe(200);
    expect(await parseJsonResponse(response)).toEqual({
      url: "https://checkout.stripe.test/session"
    });
    const order = await prisma.order.findFirstOrThrow({
      include: { reservation: true }
    });
    expect(order).toMatchObject({
      status: "pending",
      quantity: 2,
      unitPrice: 2500,
      totalAmount: 5000,
      stripeSessionId: "cs_integration_success"
    });
    expect(order.reservation).toMatchObject({
      status: "active",
      quantity: 2
    });

    const expectedExpiresAtSeconds =
      Math.ceil(new Date("2026-05-01T10:00:00.000Z").getTime() / 1000) + 30 * 60;
    expect(order.reservation?.expiresAt.getTime()).toBe(
      expectedExpiresAtSeconds * 1000
    );
    expect(stripeMocks.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        expires_at: expectedExpiresAtSeconds,
        metadata: expect.objectContaining({
          orderId: order.id,
          eventId: event.id,
          organisationId: organisation.id,
          ticketTypeId: event.ticketTypes[0].id,
          quantity: "2"
        })
      })
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

  test("Stripe session creation failure fails order and releases reservation", async () => {
    stripeMocks.createSession.mockRejectedValueOnce(new Error("stripe unavailable"));
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
        quantity: 1
      })
    );

    expect(response.status).toBe(500);
    const order = await prisma.order.findFirstOrThrow({
      include: { reservation: true }
    });
    expect(order.status).toBe("failed");
    expect(order.failureReason).toBe("stripe_error");
    expect(order.reservation?.status).toBe("released");
  });
});
