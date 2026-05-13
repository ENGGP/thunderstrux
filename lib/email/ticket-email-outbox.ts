import { randomUUID } from "node:crypto";
import type { EmailOutboxMode, EmailOutboxStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  sendTicketDeliveryEmailToProvider,
  truncateTicketEmailError
} from "@/lib/email/ticket-delivery";

const defaultBatchSize = 25;
const defaultMaxAttempts = 5;
const defaultProcessingTimeoutSeconds = 10 * 60;
const backoffSeconds = [60, 5 * 60, 15 * 60, 60 * 60, 6 * 60 * 60];

type ClaimedEmailJob = {
  id: string;
  orderId: string;
  mode: EmailOutboxMode;
  status: EmailOutboxStatus;
  attempts: number;
};

type InsertedEmailJob = {
  id: string;
};

let automaticOutboxEnqueueTestFailure: Error | null = null;

export function setAutomaticOutboxEnqueueTestFailure(error: Error | null) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Automatic outbox enqueue failure injection is test-only");
  }

  automaticOutboxEnqueueTestFailure = error;
}

export function getEmailOutboxBatchSize() {
  const parsed = Number(process.env.EMAIL_OUTBOX_BATCH_SIZE);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultBatchSize;
}

export function getEmailOutboxMaxAttempts() {
  const parsed = Number(process.env.EMAIL_OUTBOX_MAX_ATTEMPTS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultMaxAttempts;
}

export function getEmailOutboxProcessingTimeoutSeconds() {
  const parsed = Number(process.env.EMAIL_OUTBOX_PROCESSING_TIMEOUT_SECONDS);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : defaultProcessingTimeoutSeconds;
}

function nextAttemptAt(attempts: number, now: Date) {
  const delaySeconds =
    backoffSeconds[Math.min(Math.max(attempts - 1, 0), backoffSeconds.length - 1)];

  return new Date(now.getTime() + delaySeconds * 1000);
}

export async function enqueueTicketEmail({
  orderId,
  mode
}: {
  orderId: string;
  mode: EmailOutboxMode;
}) {
  if (mode === "automatic") {
    return prisma.$transaction((tx) =>
      enqueueAutomaticTicketEmailForOrder(tx, orderId)
    );
  }

  const result = await prisma.emailOutbox.createMany({
    data: {
      orderId,
      mode
    },
    skipDuplicates: false
  });

  return { enqueued: result.count > 0 };
}

export async function enqueueAutomaticTicketEmailForOrder(
  tx: Prisma.TransactionClient,
  orderId: string
) {
  if (automaticOutboxEnqueueTestFailure) {
    throw automaticOutboxEnqueueTestFailure;
  }

  const id = `email_${randomUUID()}`;
  const rows = await tx.$queryRaw<InsertedEmailJob[]>`
    INSERT INTO "EmailOutbox" ("id", "orderId", "mode", "updatedAt")
    VALUES (${id}, ${orderId}, 'automatic'::"EmailOutboxMode", now())
    ON CONFLICT ("orderId") WHERE "mode" = 'automatic'::"EmailOutboxMode"
    DO NOTHING
    RETURNING "id"
  `;

  return { enqueued: rows.length > 0 };
}

export async function claimTicketEmailOutboxJobs({
  limit = getEmailOutboxBatchSize(),
  now = new Date(),
  processingTimeoutSeconds = getEmailOutboxProcessingTimeoutSeconds()
}: {
  limit?: number;
  now?: Date;
  processingTimeoutSeconds?: number;
} = {}) {
  const staleBefore = new Date(now.getTime() - processingTimeoutSeconds * 1000);

  return prisma.$queryRaw<ClaimedEmailJob[]>`
    UPDATE "EmailOutbox"
    SET
      "status" = 'processing'::"EmailOutboxStatus",
      "processingStartedAt" = ${now},
      "updatedAt" = ${now}
    WHERE "id" IN (
      SELECT "id"
      FROM "EmailOutbox"
      WHERE
        (
          "status" = 'pending'::"EmailOutboxStatus"
          AND "nextAttemptAt" <= ${now}
        )
        OR (
          "status" = 'processing'::"EmailOutboxStatus"
          AND "processingStartedAt" < ${staleBefore}
        )
      ORDER BY "nextAttemptAt" ASC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING "id", "orderId", "mode", "status", "attempts"
  `;
}

async function markJobSent({
  job,
  now,
  providerMessageId
}: {
  job: ClaimedEmailJob;
  now: Date;
  providerMessageId: string | null;
}) {
  await prisma.$transaction([
    prisma.emailOutbox.update({
      where: { id: job.id },
      data: {
        status: "sent",
        sentAt: now,
        deliveredToProviderAt: now,
        providerMessageId,
        lastError: null,
        processingStartedAt: null
      }
    }),
    prisma.order.update({
      where: { id: job.orderId },
      data:
        job.mode === "automatic"
          ? {
              ticketEmailSentAt: now,
              ticketEmailLastError: null
            }
          : {
              ticketEmailResentAt: now,
              ticketEmailLastError: null
            }
    })
  ]);
}

async function markJobFailed({
  job,
  error,
  now,
  maxAttempts = getEmailOutboxMaxAttempts()
}: {
  job: ClaimedEmailJob;
  error: unknown;
  now: Date;
  maxAttempts?: number;
}) {
  const attempts = job.attempts + 1;
  const message = truncateTicketEmailError(
    error instanceof Error ? error.message : "Unknown email failure"
  );
  const exhausted = attempts >= maxAttempts;

  await prisma.$transaction([
    prisma.emailOutbox.update({
      where: { id: job.id },
      data: {
        status: exhausted ? "failed" : "pending",
        attempts,
        nextAttemptAt: exhausted ? now : nextAttemptAt(attempts, now),
        processingStartedAt: null,
        lastError: message
      }
    }),
    prisma.order.update({
      where: { id: job.orderId },
      data: {
        ticketEmailLastError: message
      }
    })
  ]);
}

export async function processTicketEmailOutboxBatch({
  limit = getEmailOutboxBatchSize(),
  now = new Date(),
  maxAttempts = getEmailOutboxMaxAttempts(),
  processingTimeoutSeconds = getEmailOutboxProcessingTimeoutSeconds()
}: {
  limit?: number;
  now?: Date;
  maxAttempts?: number;
  processingTimeoutSeconds?: number;
} = {}) {
  const jobs = await claimTicketEmailOutboxJobs({
    limit,
    now,
    processingTimeoutSeconds
  });
  const result = {
    claimed: jobs.length,
    sent: 0,
    retried: 0,
    failed: 0,
    skipped: 0
  };

  for (const job of jobs) {
    try {
      const order = await prisma.order.findUnique({
        where: { id: job.orderId },
        select: { ticketEmailSentAt: true }
      });

      if (!order) {
        throw new Error("Order not found");
      }

      if (job.mode === "automatic" && order.ticketEmailSentAt) {
        await prisma.emailOutbox.update({
          where: { id: job.id },
          data: {
            status: "sent",
            sentAt: now,
            lastError: null,
            processingStartedAt: null
          }
        });
        result.skipped += 1;
        continue;
      }

      const delivery = await sendTicketDeliveryEmailToProvider(job.orderId, {
        idempotencyKey: `ticket-email/${job.id}`
      });
      await markJobSent({
        job,
        now,
        providerMessageId: delivery.providerMessageId
      });
      result.sent += 1;
    } catch (error) {
      await markJobFailed({ job, error, now, maxAttempts });

      if (job.attempts + 1 >= maxAttempts) {
        result.failed += 1;
      } else {
        result.retried += 1;
      }
    }
  }

  return result;
}
