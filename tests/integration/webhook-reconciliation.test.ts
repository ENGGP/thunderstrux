import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { reconcileCompletedCheckoutSessionWithSideEffects } from "@/lib/payments/checkout-fulfilment-orchestrator";
import { reconcileCompletedCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import { setAutomaticOutboxEnqueueTestFailure } from "@/lib/email/ticket-email-outbox";
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
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
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
      include: { reservation: true, tickets: true, emailOutboxJobs: true }
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
    expect(paidOrder.emailOutboxJobs).toHaveLength(1);
    expect(paidOrder.emailOutboxJobs[0]).toMatchObject({
      mode: "automatic",
      status: "pending"
    });
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
    expect(
      error.mock.calls.filter(([message]) => message === "Operational alert")
    ).toHaveLength(0);
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
          requiresCompensationReview: true,
          fulfilmentFailedAt: true,
          fulfilmentFailureReason: true,
          ticketEmailSentAt: true,
          ticketEmailLastError: true,
          tickets: true,
          emailOutboxJobs: true
        }
      });
      expect(result).toEqual({ status: "fulfilled", orderId: order.id });
      expect(updated.status).toBe("paid");
      expect(updated.requiresCompensationReview).toBe(false);
      expect(updated.fulfilmentFailedAt).toBeNull();
      expect(updated.fulfilmentFailureReason).toBeNull();
      expect(updated.tickets).toHaveLength(1);
      expect(updated.emailOutboxJobs).toHaveLength(1);
      expect(updated.emailOutboxJobs[0]).toMatchObject({
        mode: "automatic",
        status: "pending"
      });
      expect(updated.ticketEmailSentAt).toBeNull();
      expect(updated.ticketEmailLastError).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      restoreEmailEnv();
    }
  });

  test("automatic outbox enqueue failure rolls back paid fulfilment", async () => {
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const member = await createMember();
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published",
      ticketTypes: [{ name: "General", price: 1000, quantity: 3 }]
    });
    const ticketType = event.ticketTypes[0];
    const order = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      quantity: 2,
      unitPrice: ticketType.price,
      stripeSessionId: "cs_outbox_enqueue_failure"
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

    setAutomaticOutboxEnqueueTestFailure(new Error("outbox insert failed"));

    try {
      await expect(
        reconcileCompletedCheckoutSession(
          checkoutSession({
            id: "cs_outbox_enqueue_failure",
            orderId: order.id,
            eventId: event.id,
            organisationId: organisation.id,
            ticketTypeId: ticketType.id,
            quantity: 2,
            amountTotal: 2000
          })
        )
      ).rejects.toThrow("outbox insert failed");
    } finally {
      setAutomaticOutboxEnqueueTestFailure(null);
    }

    const unchangedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { reservation: true, tickets: true, emailOutboxJobs: true }
    });
    const unchangedTicketType = await prisma.ticketType.findUniqueOrThrow({
      where: { id: ticketType.id }
    });

    expect(unchangedOrder.status).toBe("pending");
    expect(unchangedOrder.paidAt).toBeNull();
    expect(unchangedOrder.reservation?.status).toBe("active");
    expect(unchangedOrder.reservation?.confirmedAt).toBeNull();
    expect(unchangedOrder.tickets).toHaveLength(0);
    expect(unchangedOrder.emailOutboxJobs).toHaveLength(0);
    expect(unchangedTicketType.quantity).toBe(3);
  });

  test("successful fulfilment enqueues automatic ticket email once", async () => {
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
          tickets: true,
          emailOutboxJobs: true
        }
      });
      expect(updated.status).toBe("paid");
      expect(result).toEqual({ status: "fulfilled", orderId: order.id });
      expect(duplicateResult).toEqual({
        status: "already_paid",
        orderId: order.id
      });
      expect(updated.ticketEmailSentAt).toBeNull();
      expect(updated.ticketEmailLastError).toBeNull();
      expect(updated.tickets).toHaveLength(2);
      expect(updated.emailOutboxJobs).toHaveLength(1);
      expect(updated.emailOutboxJobs[0]).toMatchObject({
        mode: "automatic",
        status: "pending",
        attempts: 0
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      restoreEmailEnv();
    }
  });

  test("ticket email enqueue is independent of provider configuration", async () => {
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
        include: { reservation: true, tickets: true, emailOutboxJobs: true }
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
      expect(fulfilled.ticketEmailLastError).toBeNull();
      expect(fulfilled.emailOutboxJobs).toHaveLength(1);
      expect(fulfilled.emailOutboxJobs[0]).toMatchObject({
        mode: "automatic",
        status: "pending"
      });
      expect(error).not.toHaveBeenCalled();
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

  test("paid amount mismatch marks compensation review without issuing tickets or email", async () => {
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
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

    const result = await reconcileCompletedCheckoutSessionWithSideEffects(
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
    expect(result).toEqual({
      status: "compensation_required",
      orderId: order.id,
      reason: "webhook_mismatch"
    });
    expect(failed.status).toBe("failed");
    expect(failed.paidAt).toEqual(new Date("2026-05-01T12:00:00.000Z"));
    expect(failed.failureReason).toBe("webhook_mismatch");
    expect(failed.requiresCompensationReview).toBe(true);
    expect(failed.fulfilmentFailedAt).toEqual(
      new Date("2026-05-01T12:00:00.000Z")
    );
    expect(failed.fulfilmentFailureReason).toBe("webhook_mismatch");
    expect(failed.tickets).toHaveLength(0);
    expect(failed.reservation?.status).toBe("released");
    await expect(
      prisma.emailOutbox.count({ where: { orderId: order.id } })
    ).resolves.toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "Stripe checkout reconciliation failed",
      expect.objectContaining({ message: "webhook_mismatch" })
    );
  });

  test("paid inventory mismatch is compensation-required and duplicate delivery preserves diagnostics", async () => {
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const member = await createMember();
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published",
      ticketTypes: [{ name: "General", price: 1000, quantity: 1 }]
    });
    const ticketType = event.ticketTypes[0];
    const order = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      quantity: 2,
      unitPrice: ticketType.price,
      stripeSessionId: "cs_inventory_compensation"
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
      id: "cs_inventory_compensation",
      orderId: order.id,
      eventId: event.id,
      organisationId: organisation.id,
      ticketTypeId: ticketType.id,
      quantity: 2,
      amountTotal: 2000
    });
    const first = await reconcileCompletedCheckoutSessionWithSideEffects(session);
    vi.setSystemTime(new Date("2026-05-01T12:05:00.000Z"));
    const duplicate = await reconcileCompletedCheckoutSessionWithSideEffects(session);

    const updated = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { reservation: true, tickets: true }
    });
    expect(first).toEqual({
      status: "compensation_required",
      orderId: order.id,
      reason: "inventory_unavailable_after_payment"
    });
    expect(duplicate).toEqual({
      status: "compensation_required",
      orderId: order.id,
      reason: "inventory_unavailable_after_payment"
    });
    expect(updated.status).toBe("failed");
    expect(updated.requiresCompensationReview).toBe(true);
    expect(updated.paidAt).toEqual(new Date("2026-05-01T12:00:00.000Z"));
    expect(updated.fulfilmentFailedAt).toEqual(
      new Date("2026-05-01T12:00:00.000Z")
    );
    expect(updated.fulfilmentFailureReason).toBe(
      "inventory_unavailable_after_payment"
    );
    expect(updated.tickets).toHaveLength(0);
    expect(updated.reservation?.status).toBe("released");
    await expect(
      prisma.emailOutbox.count({ where: { orderId: order.id } })
    ).resolves.toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    const alertCalls = error.mock.calls.filter(
      ([message]) => message === "Operational alert"
    );
    expect(alertCalls).toHaveLength(1);
    expect(alertCalls[0][1]).toEqual({
      event: "paid_but_unfulfilled_compensation_required",
      orderId: order.id,
      stripeSessionId: "cs_inventory_compensation",
      eventId: event.id,
      reason: "inventory_unavailable_after_payment",
      source: "webhook"
    });
    expect(JSON.stringify(alertCalls)).not.toContain(member.email);
    expect(JSON.stringify(alertCalls)).not.toContain("stripe-signature");
    expect(JSON.stringify(alertCalls)).not.toContain("metadata");
  });

  test("future retry can clear compensation warning when active reservation naturally remains recoverable", async () => {
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const restoreEmailEnv = configureEmailEnv();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { organisation } = await createOrganisationAccount({ stripeReady: true });
      const member = await createMember({ email: "retry-recovery@example.com" });
      const event = await createEvent({
        organisationId: organisation.id,
        status: "published",
        ticketTypes: [{ name: "General", price: 1000, quantity: 3 }]
      });
      const ticketType = event.ticketTypes[0];
      const failedAt = new Date("2026-05-01T11:55:00.000Z");
      const order = await createOrder({
        organisationId: organisation.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        userId: member.id,
        status: "failed",
        quantity: 1,
        unitPrice: ticketType.price,
        stripeSessionId: "cs_compensation_retry",
        paidAt: failedAt,
        failedAt,
        failureReason: "reservation_confirm_failed_after_payment",
        requiresCompensationReview: true,
        fulfilmentFailedAt: failedAt,
        fulfilmentFailureReason: "reservation_confirm_failed_after_payment"
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
          id: "cs_compensation_retry",
          orderId: order.id,
          eventId: event.id,
          organisationId: organisation.id,
          ticketTypeId: ticketType.id,
          quantity: 1,
          amountTotal: 1000
        })
      );

      const recovered = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { reservation: true, tickets: true, emailOutboxJobs: true }
      });
      expect(result).toEqual({ status: "fulfilled", orderId: order.id });
      expect(recovered.status).toBe("paid");
      expect(recovered.requiresCompensationReview).toBe(false);
      expect(recovered.failedAt).toBeNull();
      expect(recovered.failureReason).toBeNull();
      expect(recovered.fulfilmentFailedAt).toEqual(failedAt);
      expect(recovered.fulfilmentFailureReason).toBe(
        "reservation_confirm_failed_after_payment"
      );
      expect(recovered.reservation?.status).toBe("confirmed");
      expect(recovered.tickets).toHaveLength(1);
      expect(recovered.emailOutboxJobs).toHaveLength(1);
      expect(recovered.emailOutboxJobs[0]).toMatchObject({
        mode: "automatic",
        status: "pending"
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(
        error.mock.calls.filter(([message]) => message === "Operational alert")
      ).toHaveLength(0);
    } finally {
      restoreEmailEnv();
    }
  });

  test("already-paid order with ticket mismatch is not mutated into compensation review", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const member = await createMember();
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published",
      ticketTypes: [{ name: "General", price: 1000, quantity: 3 }]
    });
    const ticketType = event.ticketTypes[0];
    const order = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "paid",
      quantity: 2,
      unitPrice: ticketType.price,
      stripeSessionId: "cs_paid_ticket_mismatch",
      paidAt: new Date("2026-05-01T12:00:00.000Z")
    });
    await prisma.ticket.create({
      data: {
        orderId: order.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        organisationId: organisation.id
      }
    });

    const result = await reconcileCompletedCheckoutSession(
      checkoutSession({
        id: "cs_paid_ticket_mismatch",
        orderId: order.id,
        eventId: event.id,
        organisationId: organisation.id,
        ticketTypeId: ticketType.id,
        quantity: 2,
        amountTotal: 2000
      })
    );

    const unchanged = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { tickets: true }
    });
    expect(result).toEqual({ status: "already_paid", orderId: order.id });
    expect(unchanged.status).toBe("paid");
    expect(unchanged.requiresCompensationReview).toBe(false);
    expect(unchanged.fulfilmentFailedAt).toBeNull();
    expect(unchanged.fulfilmentFailureReason).toBeNull();
    expect(unchanged.tickets).toHaveLength(1);
    expect(error).toHaveBeenCalledWith(
      "Stripe checkout reconciliation failed",
      expect.objectContaining({
        message:
          "Paid order ticket count does not match quantity; historical integrity review required"
      })
    );
  });

  test("expired order receiving completed paid session requires compensation review", async () => {
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
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

    const result = await reconcileCompletedCheckoutSession(
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
    expect(result).toEqual({
      status: "compensation_required",
      orderId: order.id,
      reason: "expired_order_paid_after_payment"
    });
    expect(unchanged.status).toBe("failed");
    expect(unchanged.requiresCompensationReview).toBe(true);
    expect(unchanged.paidAt).toEqual(new Date("2026-05-01T12:00:00.000Z"));
    expect(unchanged.tickets).toHaveLength(0);
    expect(currentTicketType.quantity).toBe(ticketType.quantity);
    expect(warn).toHaveBeenCalledWith(
      "Stripe checkout completed for expired order",
      expect.any(Object)
    );
  });

  test("paid sessions with expired or missing reservations require compensation review", async () => {
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
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
      prisma.order.findUniqueOrThrow({
        where: { id: expiredReservationOrder.id },
        include: { reservation: true }
      })
    ).resolves.toMatchObject({
      status: "failed",
      requiresCompensationReview: true,
      fulfilmentFailureReason: "reservation_expired_after_payment",
      reservation: { status: "expired" }
    });

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
    ).resolves.toMatchObject({
      status: "failed",
      requiresCompensationReview: true,
      fulfilmentFailureReason: "reservation_missing_after_payment"
    });

    await expect(prisma.ticket.count()).resolves.toBe(0);
  });
});
