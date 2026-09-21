import { randomUUID } from "node:crypto";
import type { EmailOutboxMode, EmailOutboxStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  sendTicketDeliveryEmailToProvider,
  truncateTicketEmailError
} from "@/lib/email/ticket-delivery";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logError, logInfo } from "@/lib/ops/logger";
import { emitMetric } from "@/lib/ops/metrics";
import {
  appendOrderLifecycleEvent,
  lockOrder
} from "@/lib/payments/order-lifecycle";

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
  processingToken: string;
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
  mode,
  actorUserId
}: {
  orderId: string;
  mode: EmailOutboxMode;
  actorUserId?: string;
}) {
  if (mode === "automatic") {
    return prisma.$transaction((tx) =>
      enqueueAutomaticTicketEmailForOrder(tx, orderId)
    );
  }

  return prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, orderId))) return { enqueued: false };
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        status: true,
        requiresCompensationReview: true,
        reservation: { select: { status: true } }
      }
    });
    const job = await tx.emailOutbox.create({
      data: { orderId, mode },
      select: { id: true }
    });
    await appendOrderLifecycleEvent(tx, {
      orderId,
      type: "email_enqueued",
      source: "staff_action",
      actorUserId,
      emailOutboxId: job.id,
      fromOrderStatus: order.status,
      toOrderStatus: order.status,
      facts: { emailMode: mode },
      baseline: {
        orderStatus: order.status,
        reservationStatus: order.reservation?.status,
        compensationReview: order.requiresCompensationReview
      }
    });
    return { enqueued: true };
  });
}

export async function enqueueAutomaticTicketEmailForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  source: "stripe_webhook" | "development_fallback" = "stripe_webhook"
) {
  if (automaticOutboxEnqueueTestFailure) {
    throw automaticOutboxEnqueueTestFailure;
  }

  if (!(await lockOrder(tx, orderId))) return { enqueued: false };
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      status: true,
      requiresCompensationReview: true,
      reservation: { select: { status: true } }
    }
  });
  const id = `email_${randomUUID()}`;
  const rows = await tx.$queryRaw<InsertedEmailJob[]>`
    INSERT INTO "EmailOutbox" ("id", "orderId", "mode", "updatedAt")
    VALUES (${id}, ${orderId}, 'automatic'::"EmailOutboxMode", now())
    ON CONFLICT ("orderId") WHERE "mode" = 'automatic'::"EmailOutboxMode"
    DO NOTHING
    RETURNING "id"
  `;

  if (rows[0]) {
    await appendOrderLifecycleEvent(tx, {
      orderId,
      type: "email_enqueued",
      source,
      emailOutboxId: rows[0].id,
      facts: { emailMode: "automatic" },
      fromOrderStatus: order.status,
      toOrderStatus: order.status,
      baseline: {
        orderStatus: order.status,
        reservationStatus: order.reservation?.status,
        compensationReview: order.requiresCompensationReview
      }
    });
  }

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
      "processingToken" = gen_random_uuid()::text,
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
    RETURNING "id", "orderId", "mode", "status", "attempts", "processingToken"
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
  return prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, job.orderId))) return false;
    const order = await tx.order.findUniqueOrThrow({
      where: { id: job.orderId },
      select: {
        status: true,
        requiresCompensationReview: true,
        reservation: { select: { status: true } }
      }
    });
    const updated = await tx.emailOutbox.updateMany({
      where: {
        id: job.id,
        status: "processing",
        processingToken: job.processingToken
      },
      data: {
        status: "sent",
        sentAt: now,
        deliveredToProviderAt: now,
        providerMessageId,
        lastError: null,
        processingStartedAt: null,
        processingToken: null
      }
    });
    if (updated.count === 0) return false;
    await tx.order.update({
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
    });
    await appendOrderLifecycleEvent(tx, {
      orderId: job.orderId,
      type: "email_provider_accepted",
      source: "email_worker",
      emailOutboxId: job.id,
      fromOrderStatus: order.status,
      toOrderStatus: order.status,
      facts: { emailMode: job.mode },
      baseline: {
        orderStatus: order.status,
        reservationStatus: order.reservation?.status,
        compensationReview: order.requiresCompensationReview
      }
    });
    return true;
  });
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

  const applied = await prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, job.orderId))) return false;
    const order = await tx.order.findUniqueOrThrow({
      where: { id: job.orderId },
      select: {
        status: true,
        requiresCompensationReview: true,
        reservation: { select: { status: true } }
      }
    });
    const updated = await tx.emailOutbox.updateMany({
      where: {
        id: job.id,
        status: "processing",
        processingToken: job.processingToken
      },
      data: {
        status: exhausted ? "failed" : "pending",
        attempts,
        nextAttemptAt: exhausted ? now : nextAttemptAt(attempts, now),
        processingStartedAt: null,
        lastError: message,
        processingToken: null
      }
    });
    if (updated.count === 0) return false;
    await tx.order.update({
      where: { id: job.orderId },
      data: {
        ticketEmailLastError: message
      }
    });
    await appendOrderLifecycleEvent(tx, {
      orderId: job.orderId,
      type: exhausted ? "email_delivery_exhausted" : "email_retry_scheduled",
      source: "email_worker",
      emailOutboxId: job.id,
      reason: "provider_error",
      fromOrderStatus: order.status,
      toOrderStatus: order.status,
      facts: { emailMode: job.mode, emailTerminal: exhausted },
      baseline: {
        orderStatus: order.status,
        reservationStatus: order.reservation?.status,
        compensationReview: order.requiresCompensationReview
      }
    });
    return true;
  });

  if (!applied) return { applied: false, exhausted };

  logError("email_outbox.job.failed", {
    jobId: job.id,
    orderId: job.orderId,
    mode: job.mode,
    attempts,
    terminal: exhausted,
    errorName: error instanceof Error ? error.name : "UnknownError"
  });
  emitMetric("email_outbox_jobs_failed_total", 1, {
    mode: job.mode,
    terminal: exhausted
  });

  if (exhausted) {
    emitOperationalAlert("email_outbox_retry_exhausted", {
      jobId: job.id,
      orderId: job.orderId,
      mode: job.mode,
      attempts
    });
  }
  return { applied: true, exhausted };
}

async function markJobAlreadySent(job: ClaimedEmailJob, now: Date) {
  return prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, job.orderId))) return false;
    const updated = await tx.emailOutbox.updateMany({
      where: {
        id: job.id,
        status: "processing",
        processingToken: job.processingToken
      },
      data: {
        status: "sent",
        sentAt: now,
        lastError: null,
        processingStartedAt: null,
        processingToken: null
      }
    });
    return updated.count > 0;
  });
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
        await markJobAlreadySent(job, now);
        result.skipped += 1;
        continue;
      }

      let delivery;
      try {
        delivery = await sendTicketDeliveryEmailToProvider(job.orderId, {
          idempotencyKey: `ticket-email/${job.id}`
        });
      } catch (error) {
        const failure = await markJobFailed({ job, error, now, maxAttempts });
        if (!failure.applied) result.skipped += 1;
        else if (failure.exhausted) result.failed += 1;
        else result.retried += 1;
        continue;
      }

      try {
        const applied = await markJobSent({
          job,
          now,
          providerMessageId: delivery.providerMessageId
        });
        if (!applied) {
          result.skipped += 1;
          continue;
        }
        result.sent += 1;
        emitMetric("email_outbox_jobs_sent_total", 1, { mode: job.mode });
      } catch (error) {
        logError("email_outbox.job.finalization_failed", {
          jobId: job.id,
          orderId: job.orderId,
          mode: job.mode,
          error
        });
        result.skipped += 1;
      }
    } catch (error) {
      logError("email_outbox.job.processing_failed", {
        jobId: job.id,
        orderId: job.orderId,
        mode: job.mode,
        error
      });
      result.skipped += 1;
    }
  }

  logInfo("email_outbox.batch.processed", result);

  return result;
}
