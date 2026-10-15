-- T14a: one durable record per intended checkout. Additive; no existing order
-- gets an attempt, because none was created through one.
CREATE TYPE "CheckoutFamily" AS ENUM ('ticket');
CREATE TYPE "CheckoutActorKind" AS ENUM ('user');
CREATE TYPE "CheckoutAttemptState" AS ENUM ('created', 'provider_uncertain', 'provider_attached', 'failed');

CREATE TABLE "CheckoutAttempt" (
    "id" TEXT NOT NULL,
    "family" "CheckoutFamily" NOT NULL,
    "actorKind" "CheckoutActorKind" NOT NULL,
    "actorId" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "clientIdempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "orderId" TEXT,
    "providerOperationKey" TEXT NOT NULL,
    "stripeSessionId" TEXT,
    "stripeSessionUrl" TEXT,
    "state" "CheckoutAttemptState" NOT NULL DEFAULT 'created',
    "reconcileDueAt" TIMESTAMP(3),
    "lastOutcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutAttempt_pkey" PRIMARY KEY ("id"),
    -- Only ticket attempts exist yet, and they bind an Order; commerce (T21) adds its own reference.
    CONSTRAINT "CheckoutAttempt_ticket_order_chk" CHECK ("orderId" IS NULL OR "family" = 'ticket'),
    -- An attached attempt always knows its Session.
    CONSTRAINT "CheckoutAttempt_attached_session_chk" CHECK ("state" <> 'provider_attached' OR ("stripeSessionId" IS NOT NULL AND "stripeSessionUrl" IS NOT NULL))
);

CREATE UNIQUE INDEX "CheckoutAttempt_orderId_key" ON "CheckoutAttempt"("orderId");
CREATE UNIQUE INDEX "CheckoutAttempt_providerOperationKey_key" ON "CheckoutAttempt"("providerOperationKey");
CREATE UNIQUE INDEX "CheckoutAttempt_stripeSessionId_key" ON "CheckoutAttempt"("stripeSessionId");
CREATE INDEX "CheckoutAttempt_state_reconcileDueAt_idx" ON "CheckoutAttempt"("state", "reconcileDueAt");
CREATE UNIQUE INDEX "CheckoutAttempt_actor_key_key" ON "CheckoutAttempt"("actorKind", "actorId", "family", "operationType", "clientIdempotencyKey");

ALTER TABLE "CheckoutAttempt" ADD CONSTRAINT "CheckoutAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
