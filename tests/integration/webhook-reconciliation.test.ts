import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { reconcileCompletedCheckoutSessionWithSideEffects } from "@/lib/payments/checkout-fulfilment-orchestrator";
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
  function configureEmailEnv() {
    const previousApiKey = process.env.RESEND_API_KEY;
    const previousFrom = process.env.EMAIL_FROM;

    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Thunderstrux <tickets@example.com>";

    return () => {
      if (previousApiKey === undefined) {
        delete process.env.RESEND_API_KEY;
      } else {
        process.env.RESEND_API_KEY = previousApiKey;
      }

      if (previousFrom === undefined) {
        delete process.env.EMAIL_FROM;
      } else {
        process.env.EMAIL_FROM = previousFrom;
      }
    };
  }

  test("paid checkout session confirms reservation, issues tickets, decrements inventory, and is idempotent", async () => {
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    const result = await reconcileCompletedCheckoutSession(session, {
      stripeEventId: "evt_1"
    });
    const duplicateResult = await reconcileCompletedCheckoutSession(session, {
      stripeEventId: "evt_1_duplicate"
    });

    const paidOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { reservation: true, tickets: true }
    });
    const updatedTicketType = await prisma.ticketType.findUniqueOrThrow({
      where: { id: ticketType.id }
    });
    expect(paidOrder.status).toBe("paid");
    expect(result).toEqual({ status: "fulfilled", orderId: order.id });
    expect(duplicateResult).toEqual({ status: "already_paid", orderId: order.id });
    expect(paidOrder.paidAt).toEqual(new Date("2026-05-01T12:00:00.000Z"));
    expect(paidOrder.reservation?.status).toBe("confirmed");
    expect(paidOrder.tickets).toHaveLength(2);
    expect(
      paidOrder.tickets.every((ticket) => ticket.organisationId === event.organisationId)
    ).toBe(true);
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

  test("ticket issuance uses event organisation when order organisation is inconsistent", async () => {
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const other = await createOrganisationAccount({ stripeReady: true });
    const member = await createMember();
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published",
      ticketTypes: [{ name: "General", price: 1000, quantity: 5 }]
    });
    const ticketType = event.ticketTypes[0];
    const order = await createOrder({
      organisationId: other.organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      quantity: 2,
      unitPrice: ticketType.price,
      stripeSessionId: "cs_ticket_org_guard"
    });
    await createReservation({
      orderId: order.id,
      organisationId: other.organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      quantity: 2,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    });

    const result = await reconcileCompletedCheckoutSession(
      checkoutSession({
        id: "cs_ticket_org_guard",
        orderId: order.id,
        eventId: event.id,
        organisationId: other.organisation.id,
        ticketTypeId: ticketType.id,
        quantity: 2,
        amountTotal: 2000
      })
    );

    const paidOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { tickets: true }
    });

    expect(result).toEqual({ status: "fulfilled", orderId: order.id });
    expect(paidOrder.status).toBe("paid");
    expect(paidOrder.tickets).toHaveLength(2);
    expect(
      paidOrder.tickets.every((ticket) => ticket.organisationId === event.organisationId)
    ).toBe(true);
    expect(error).toHaveBeenCalledWith(
      "Ticket organisation mismatch corrected during checkout reconciliation",
      expect.objectContaining({
        orderId: order.id,
        eventId: event.id,
        stripeSessionId: "cs_ticket_org_guard",
        orderOrganisationId: other.organisation.id,
        eventOrganisationId: organisation.id
      })
    );
  });

  test("reconciliation does not send ticket email directly", async () => {
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    const restoreEmailEnv = configureEmailEnv();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { organisation } = await createOrganisationAccount({ stripeReady: true });
      const member = await createMember({ email: "reconcile-only@example.com" });
      const event = await createEvent({
        organisationId: organisation.id,
        status: "published",
        ticketTypes: [{ name: "General", price: 1000, quantity: 2 }]
      });
      const ticketType = event.ticketTypes[0];
      const order = await createOrder({
        organisationId: organisation.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        userId: member.id,
        quantity: 1,
        unitPrice: ticketType.price,
        stripeSessionId: "cs_reconcile_only"
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

      const result = await reconcileCompletedCheckoutSession(
        checkoutSession({
          id: "cs_reconcile_only",
          orderId: order.id,
          eventId: event.id,
          organisationId: organisation.id,
          ticketTypeId: ticketType.id,
          quantity: 1,
          amountTotal: 1000
        })
      );

      const updated = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        select: {
          status: true,
          ticketEmailSentAt: true,
          ticketEmailLastError: true,
          tickets: true
        }
      });
      expect(result).toEqual({ status: "fulfilled", orderId: order.id });
      expect(updated.status).toBe("paid");
      expect(updated.tickets).toHaveLength(1);
      expect(updated.ticketEmailSentAt).toBeNull();
      expect(updated.ticketEmailLastError).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      restoreEmailEnv();
    }
  });

  test("successful fulfilment sends ticket email once and tracks sent timestamp", async () => {
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    const restoreEmailEnv = configureEmailEnv();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { organisation } = await createOrganisationAccount({ stripeReady: true });
      const member = await createMember({ email: "ticket-email@example.com" });
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
        stripeSessionId: "cs_ticket_email"
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
        id: "cs_ticket_email",
        orderId: order.id,
        eventId: event.id,
        organisationId: organisation.id,
        ticketTypeId: ticketType.id,
        quantity: 2,
        amountTotal: 2000
      });
      const result = await reconcileCompletedCheckoutSessionWithSideEffects(session);
      const duplicateResult = await reconcileCompletedCheckoutSessionWithSideEffects(
        session
      );

      const updated = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        select: {
          status: true,
          ticketEmailSentAt: true,
          ticketEmailLastError: true,
          tickets: true
        }
      });
      expect(updated.status).toBe("paid");
      expect(result).toEqual({ status: "fulfilled", orderId: order.id });
      expect(duplicateResult).toEqual({
        status: "already_paid",
        orderId: order.id
      });
      expect(updated.ticketEmailSentAt).toEqual(new Date("2026-05-01T12:00:00.000Z"));
      expect(updated.ticketEmailLastError).toBeNull();
      expect(updated.tickets).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("ticket-email@example.com")
        })
      );
    } finally {
      restoreEmailEnv();
    }
  });

  test("ticket email failure is recorded without rolling back fulfilment", async () => {
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    const previousApiKey = process.env.RESEND_API_KEY;
    const previousFrom = process.env.EMAIL_FROM;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
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
        quantity: 1,
        unitPrice: ticketType.price,
        stripeSessionId: "cs_ticket_email_failure"
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

      const result = await reconcileCompletedCheckoutSessionWithSideEffects(
        checkoutSession({
          id: "cs_ticket_email_failure",
          orderId: order.id,
          eventId: event.id,
          organisationId: organisation.id,
          ticketTypeId: ticketType.id,
          quantity: 1,
          amountTotal: 1000
        })
      );

      const fulfilled = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { reservation: true, tickets: true }
      });
      const updatedTicketType = await prisma.ticketType.findUniqueOrThrow({
        where: { id: ticketType.id }
      });
      expect(fulfilled.status).toBe("paid");
      expect(result).toEqual({ status: "fulfilled", orderId: order.id });
      expect(fulfilled.tickets).toHaveLength(1);
      expect(fulfilled.reservation?.status).toBe("confirmed");
      expect(updatedTicketType.quantity).toBe(4);
      expect(fulfilled.ticketEmailSentAt).toBeNull();
      expect(fulfilled.ticketEmailLastError).toBe("Email provider is not configured");
      expect(error).toHaveBeenCalledWith(
        "Ticket delivery email failed after checkout reconciliation",
        expect.objectContaining({ orderId: order.id })
      );
    } finally {
      if (previousApiKey === undefined) {
        delete process.env.RESEND_API_KEY;
      } else {
        process.env.RESEND_API_KEY = previousApiKey;
      }

      if (previousFrom === undefined) {
        delete process.env.EMAIL_FROM;
      } else {
        process.env.EMAIL_FROM = previousFrom;
      }
    }
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
