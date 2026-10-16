import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// One durable record per intended checkout (database spec 6.1). The same actor
// and client key always answers with the same attempt; the provider key is sent
// to Stripe as its idempotency key, so a replayed Session creation cannot make a
// second Session or charge.
export const eventCheckoutOperation = "event_checkout";

// How long a created attempt may wait for its Session before the recovery
// worker (T14b) treats it as uncertain.
export const attemptReconcileDelayMs = 2 * 60 * 1000;

type AttemptClient = Pick<Prisma.TransactionClient, "checkoutAttempt">;

export function checkoutRequestHash(request: {
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  expectedUnitPrice: number;
}) {
  const canonical = JSON.stringify([request.eventId, request.ticketTypeId, request.quantity, request.expectedUnitPrice]);
  return createHash("sha256").update(canonical).digest("hex");
}

export function newProviderOperationKey() {
  return `checkout_${randomUUID()}`;
}

export type CheckoutActor = { kind: "user" | "guest"; id: string };

// A guest actor is the checkout session's grant, so a guest's attempts are
// scoped to the session that made them.
export function findCheckoutAttempt(db: AttemptClient, actor: CheckoutActor, clientIdempotencyKey: string) {
  return db.checkoutAttempt.findFirst({
    where: {
      actorKind: actor.kind,
      actorId: actor.id,
      family: "ticket",
      operationType: eventCheckoutOperation,
      clientIdempotencyKey
    },
    include: { order: { select: { status: true } } }
  });
}

export type CheckoutAttemptWithOrder = NonNullable<Awaited<ReturnType<typeof findCheckoutAttempt>>>;

// Stripe answered and did not create anything: safe to release the hold. Any
// other error (timeout, connection, 5xx, unknown) may have created a Session.
const definiteProviderFailures = new Set([
  "StripeCardError",
  "StripeInvalidRequestError",
  "StripeAuthenticationError",
  "StripePermissionError",
  "StripeRateLimitError"
]);

export function isDefiniteProviderFailure(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    typeof error.type === "string" &&
    definiteProviderFailures.has(error.type)
  );
}

export async function markAttemptUncertain(attemptId: string, outcome: string) {
  await prisma.checkoutAttempt.updateMany({
    where: { id: attemptId, state: { in: ["created", "provider_uncertain"] } },
    data: { state: "provider_uncertain", lastOutcome: outcome, reconcileDueAt: new Date() }
  });
}

export type CheckoutAttemptStatus =
  | { attemptId: string; status: "ready"; url: string }
  | { attemptId: string; status: "processing" }
  | { attemptId: string; status: "completed"; orderId: string }
  | { attemptId: string; status: "failed" };

// The buyer-facing answer for an attempt: its order decides completed and
// failed, its Session decides ready, and anything else is still processing.
export function checkoutAttemptStatus(attempt: CheckoutAttemptWithOrder): CheckoutAttemptStatus {
  const orderStatus = attempt.order?.status;

  if (orderStatus === "paid" && attempt.orderId) {
    return { attemptId: attempt.id, status: "completed", orderId: attempt.orderId };
  }
  if (attempt.state === "failed" || orderStatus === "failed" || orderStatus === "expired") {
    return { attemptId: attempt.id, status: "failed" };
  }
  if (attempt.state === "provider_attached" && attempt.stripeSessionUrl) {
    return { attemptId: attempt.id, status: "ready", url: attempt.stripeSessionUrl };
  }
  return { attemptId: attempt.id, status: "processing" };
}

// Owner-scoped read: another actor's attempt is indistinguishable from a missing one.
export async function readCheckoutAttempt(actor: CheckoutActor, attemptId: string) {
  const attempt = await prisma.checkoutAttempt.findFirst({
    where: { id: attemptId, actorKind: actor.kind, actorId: actor.id },
    include: { order: { select: { status: true } } }
  });
  return attempt ? checkoutAttemptStatus(attempt) : null;
}
