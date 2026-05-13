import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  enqueueTicketEmail,
  processTicketEmailOutboxBatch
} from "@/lib/email/ticket-email-outbox";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount
} from "@/tests/helpers/test-data";

async function createPaidTicketOrder(email = "outbox-buyer@example.com") {
  const { organisation } = await createOrganisationAccount({ stripeReady: true });
  const member = await createMember({ email });
  const event = await createEvent({ organisationId: organisation.id });
  const ticketType = event.ticketTypes[0];
  const order = await createOrder({
    organisationId: organisation.id,
    eventId: event.id,
    ticketTypeId: ticketType.id,
    userId: member.id,
    status: "paid",
    paidAt: new Date("2026-05-01T12:00:00.000Z"),
    unitPrice: ticketType.price
  });

  await prisma.ticket.create({
    data: {
      orderId: order.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      organisationId: organisation.id
    }
  });

  return order;
}

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

describe("ticket email outbox", () => {
  test("automatic enqueue is idempotent while manual enqueue is repeatable", async () => {
    const order = await createPaidTicketOrder();

    await enqueueTicketEmail({ orderId: order.id, mode: "automatic" });
    await enqueueTicketEmail({ orderId: order.id, mode: "automatic" });
    await enqueueTicketEmail({ orderId: order.id, mode: "manual" });
    await enqueueTicketEmail({ orderId: order.id, mode: "manual" });

    await expect(
      prisma.emailOutbox.groupBy({
        by: ["mode"],
        where: { orderId: order.id },
        _count: { _all: true }
      })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mode: "automatic", _count: { _all: 1 } }),
        expect.objectContaining({ mode: "manual", _count: { _all: 2 } })
      ])
    );
  });

  test("worker sends provider email and records automatic success once", async () => {
    const restoreEnv = configureEmailEnv();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{"id":"em_automatic"}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const order = await createPaidTicketOrder("automatic-outbox@example.com");
      await enqueueTicketEmail({ orderId: order.id, mode: "automatic" });

      const result = await processTicketEmailOutboxBatch({
        now: new Date("2026-06-01T12:05:00.000Z")
      });
      const second = await processTicketEmailOutboxBatch({
        now: new Date("2026-06-01T12:06:00.000Z")
      });

      expect(result).toMatchObject({ claimed: 1, sent: 1, retried: 0, failed: 0 });
      expect(second).toMatchObject({ claimed: 0, sent: 0 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Idempotency-Key": expect.stringMatching(/^ticket-email\//)
          }),
          body: expect.stringContaining("automatic-outbox@example.com")
        })
      );
      await expect(
        prisma.order.findUniqueOrThrow({
          where: { id: order.id },
          select: { ticketEmailSentAt: true, ticketEmailResentAt: true }
        })
      ).resolves.toEqual({
        ticketEmailSentAt: new Date("2026-06-01T12:05:00.000Z"),
        ticketEmailResentAt: null
      });
      await expect(
        prisma.emailOutbox.findFirstOrThrow({ where: { orderId: order.id } })
      ).resolves.toMatchObject({
        status: "sent",
        sentAt: new Date("2026-06-01T12:05:00.000Z"),
        deliveredToProviderAt: new Date("2026-06-01T12:05:00.000Z"),
        providerMessageId: "em_automatic",
        lastError: null
      });
    } finally {
      restoreEnv();
    }
  });

  test("worker retries provider failures and leaves terminal failed jobs unclaimed", async () => {
    const restoreEnv = configureEmailEnv();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("bad", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const order = await createPaidTicketOrder("retry-outbox@example.com");
      await enqueueTicketEmail({ orderId: order.id, mode: "automatic" });
      const job = await prisma.emailOutbox.findFirstOrThrow({
        where: { orderId: order.id },
        select: { id: true }
      });

      const first = await processTicketEmailOutboxBatch({
        now: new Date("2026-06-01T12:00:00.000Z"),
        maxAttempts: 2
      });
      const second = await processTicketEmailOutboxBatch({
        now: new Date("2026-06-01T12:02:00.000Z"),
        maxAttempts: 2
      });
      const third = await processTicketEmailOutboxBatch({
        now: new Date("2026-06-01T12:30:00.000Z"),
        maxAttempts: 2
      });

      expect(first).toMatchObject({ claimed: 1, retried: 1, failed: 0 });
      expect(second).toMatchObject({ claimed: 1, retried: 0, failed: 1 });
      expect(third).toMatchObject({ claimed: 0, sent: 0, retried: 0, failed: 0 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.map((call) => call[1]?.headers)).toEqual([
        expect.objectContaining({ "Idempotency-Key": `ticket-email/${job.id}` }),
        expect.objectContaining({ "Idempotency-Key": `ticket-email/${job.id}` })
      ]);
      await expect(
        prisma.emailOutbox.findFirstOrThrow({ where: { orderId: order.id } })
      ).resolves.toMatchObject({
        status: "failed",
        attempts: 2,
        processingStartedAt: null
      });
      await expect(
        prisma.order.findUniqueOrThrow({
          where: { id: order.id },
          select: { ticketEmailSentAt: true, ticketEmailLastError: true }
        })
      ).resolves.toEqual({
        ticketEmailSentAt: null,
        ticketEmailLastError:
          "Email provider failed with status 500: bad"
      });
    } finally {
      restoreEnv();
    }
  });

  test("stale processing jobs are reclaimable but fresh processing jobs are not", async () => {
    const restoreEnv = configureEmailEnv();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const staleOrder = await createPaidTicketOrder("stale-outbox@example.com");
      const freshOrder = await createPaidTicketOrder("fresh-outbox@example.com");
      await prisma.emailOutbox.createMany({
        data: [
          {
            orderId: staleOrder.id,
            mode: "automatic",
            status: "processing",
            processingStartedAt: new Date("2026-05-01T11:00:00.000Z")
          },
          {
            orderId: freshOrder.id,
            mode: "automatic",
            status: "processing",
            processingStartedAt: new Date("2026-05-01T12:04:00.000Z")
          }
        ]
      });

      const result = await processTicketEmailOutboxBatch({
        now: new Date("2026-05-01T12:05:00.000Z"),
        processingTimeoutSeconds: 10 * 60
      });

      expect(result).toMatchObject({ claimed: 1, sent: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await expect(
        prisma.emailOutbox.findFirstOrThrow({ where: { orderId: staleOrder.id } })
      ).resolves.toMatchObject({ status: "sent" });
      await expect(
        prisma.emailOutbox.findFirstOrThrow({ where: { orderId: freshOrder.id } })
      ).resolves.toMatchObject({ status: "processing" });
    } finally {
      restoreEnv();
    }
  });

  test("manual resend jobs use distinct provider idempotency keys", async () => {
    const restoreEnv = configureEmailEnv();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{"id":"em_manual"}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const order = await createPaidTicketOrder("manual-outbox@example.com");
      await enqueueTicketEmail({ orderId: order.id, mode: "manual" });
      await enqueueTicketEmail({ orderId: order.id, mode: "manual" });

      const result = await processTicketEmailOutboxBatch({
        now: new Date("2026-06-01T12:05:00.000Z"),
        limit: 2
      });

      expect(result).toMatchObject({ claimed: 2, sent: 2 });
      const keys = fetchMock.mock.calls.map(
        (call) => (call[1]?.headers as Record<string, string>)["Idempotency-Key"]
      );
      expect(new Set(keys).size).toBe(2);
      expect(keys.every((key) => key.startsWith("ticket-email/"))).toBe(true);
    } finally {
      restoreEnv();
    }
  });

  test("concurrent workers do not process the same job twice", async () => {
    const restoreEnv = configureEmailEnv();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(new Response("{}", { status: 200 })), 25);
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      for (let index = 0; index < 4; index += 1) {
        const order = await createPaidTicketOrder(`concurrent-${index}@example.com`);
        await enqueueTicketEmail({ orderId: order.id, mode: "automatic" });
      }

      const [first, second] = await Promise.all([
        processTicketEmailOutboxBatch({
          now: new Date("2026-06-01T12:05:00.000Z"),
          limit: 2
        }),
        processTicketEmailOutboxBatch({
          now: new Date("2026-06-01T12:05:00.000Z"),
          limit: 2
        })
      ]);

      expect(first.claimed + second.claimed).toBe(4);
      expect(first.sent + second.sent).toBe(4);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      const keys = fetchMock.mock.calls.map(
        (call) => (call[1]?.headers as Record<string, string>)["Idempotency-Key"]
      );
      expect(new Set(keys).size).toBe(4);
      await expect(prisma.emailOutbox.count({ where: { status: "sent" } })).resolves.toBe(4);
    } finally {
      restoreEnv();
    }
  });
});
