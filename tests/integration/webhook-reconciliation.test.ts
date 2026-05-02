import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { reconcileCompletedCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount,
  createReservation
} from "@/tests/helpers/test-data";
import { checkoutSession } from "@/tests/helpers/stripe-mocks";

describe("webhook reconciliation", () => {
  test("paid checkout session confirms reservation, issues tickets, decrements inventory, and is idempotent", async () => {
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const member = await createMember();
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published",
      ticketTypes: [{ name: "General", price: 1000, quantity: 5 }]
    });
    const ticketType = event.ticketTypes[0];
    const order = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      quantity: 2,
      unitPrice: ticketType.price,
      stripeSessionId: "cs_paid_once"
    });
    await createReservation({
      orderId: order.id,
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      quantity: 2,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    });

    const session = checkoutSession({
      id: "cs_paid_once",
      orderId: order.id,
      eventId: event.id,
      organisationId: organisation.id,
      ticketTypeId: ticketType.id,
      quantity: 2,
      amountTotal: 2000
    });
    await reconcileCompletedCheckoutSession(session, { stripeEventId: "evt_1" });
    await reconcileCompletedCheckoutSession(session, { stripeEventId: "evt_1_duplicate" });

    const paidOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { reservation: true, tickets: true }
    });
    const updatedTicketType = await prisma.ticketType.findUniqueOrThrow({
      where: { id: ticketType.id }
    });
    expect(paidOrder.status).toBe("paid");
    expect(paidOrder.paidAt).toEqual(new Date("2026-05-01T12:00:00.000Z"));
    expect(paidOrder.reservation?.status).toBe("confirmed");
    expect(paidOrder.tickets).toHaveLength(2);
    expect(updatedTicketType.quantity).toBe(3);
    expect(info).toHaveBeenCalledWith(
      "Stripe checkout completed reconciliation started",
      expect.any(Object)
    );
    expect(info).toHaveBeenCalledWith(
      "Stripe checkout reconciliation validation passed",
      expect.any(Object)
    );
    expect(info).toHaveBeenCalledWith(
      "Stripe checkout inventory updated",
      expect.any(Object)
    );
    expect(info).toHaveBeenCalledWith(
      "Stripe checkout tickets created",
      expect.any(Object)
    );
  });

  test("wrong amount or currency fails the pending order with webhook_mismatch", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const member = await createMember();
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published"
    });
    const ticketType = event.ticketTypes[0];
    const order = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      quantity: 1,
      unitPrice: ticketType.price,
      stripeSessionId: "cs_wrong_amount"
    });
    await createReservation({
      orderId: order.id,
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      quantity: 1,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    });

    await reconcileCompletedCheckoutSession(
      checkoutSession({
        id: "cs_wrong_amount",
        orderId: order.id,
        eventId: event.id,
        organisationId: organisation.id,
        ticketTypeId: ticketType.id,
        quantity: 1,
        amountTotal: ticketType.price + 1
      })
    );

    const failed = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { reservation: true, tickets: true }
    });
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toBe("webhook_mismatch");
    expect(failed.tickets).toHaveLength(0);
    expect(failed.reservation?.status).toBe("released");
    expect(error).toHaveBeenCalledWith(
      "Stripe checkout reconciliation failed",
      expect.objectContaining({ message: "webhook_mismatch" })
    );
  });

  test("expired order receiving completed session remains expired and issues no tickets", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const order = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      status: "expired",
      quantity: 1,
      unitPrice: ticketType.price,
      stripeSessionId: "cs_expired_order"
    });

    await reconcileCompletedCheckoutSession(
      checkoutSession({
        id: "cs_expired_order",
        orderId: order.id,
        eventId: event.id,
        organisationId: organisation.id,
        ticketTypeId: ticketType.id,
        quantity: 1,
        amountTotal: ticketType.price
      })
    );

    const unchanged = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { tickets: true }
    });
    const currentTicketType = await prisma.ticketType.findUniqueOrThrow({
      where: { id: ticketType.id }
    });
    expect(unchanged.status).toBe("expired");
    expect(unchanged.paidAt).toBeNull();
    expect(unchanged.tickets).toHaveLength(0);
    expect(currentTicketType.quantity).toBe(ticketType.quantity);
    expect(warn).toHaveBeenCalledWith(
      "Stripe checkout completed for expired order",
      expect.any(Object)
    );
  });

  test("expired or missing reservations do not mark paid", async () => {
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published"
    });
    const ticketType = event.ticketTypes[0];
    const expiredReservationOrder = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      status: "pending",
      quantity: 1,
      unitPrice: ticketType.price,
      stripeSessionId: "cs_expired_reservation"
    });
    await createReservation({
      orderId: expiredReservationOrder.id,
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      quantity: 1,
      status: "expired",
      expiresAt: new Date(Date.now() - 60 * 1000)
    });

    await reconcileCompletedCheckoutSession(
      checkoutSession({
        id: "cs_expired_reservation",
        orderId: expiredReservationOrder.id,
        eventId: event.id,
        organisationId: organisation.id,
        ticketTypeId: ticketType.id,
        quantity: 1,
        amountTotal: ticketType.price
      })
    );
    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: expiredReservationOrder.id } })
    ).resolves.toMatchObject({ status: "expired", failureReason: null });

    const missingReservationOrder = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      status: "pending",
      quantity: 1,
      unitPrice: ticketType.price,
      stripeSessionId: "cs_missing_reservation"
    });
    await reconcileCompletedCheckoutSession(
      checkoutSession({
        id: "cs_missing_reservation",
        orderId: missingReservationOrder.id,
        eventId: event.id,
        organisationId: organisation.id,
        ticketTypeId: ticketType.id,
        quantity: 1,
        amountTotal: ticketType.price
      })
    );
    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: missingReservationOrder.id } })
    ).resolves.toMatchObject({ status: "failed", failureReason: "webhook_mismatch" });

    await expect(prisma.ticket.count()).resolves.toBe(0);
  });
});
