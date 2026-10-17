-- T20: membership and merchandise orders, kept apart from ticket orders. Additive.
CREATE TYPE "CommerceKind" AS ENUM ('membership', 'merchandise');
CREATE TYPE "CommerceLifecycleEventType" AS ENUM ('order_created', 'payment_fulfilled', 'free_fulfilled', 'order_failed', 'order_expired', 'compensation_required');

ALTER TYPE "CheckoutFamily" ADD VALUE 'membership';
ALTER TYPE "CheckoutFamily" ADD VALUE 'merchandise';

CREATE TABLE "CommerceOrder" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "kind" "CommerceKind" NOT NULL,
    "userId" TEXT,
    "guestIdentityId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "paymentKind" "PaymentKind" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'aud',
    "totalAmount" INTEGER NOT NULL,
    "feeAmount" INTEGER NOT NULL DEFAULT 0,
    "buyerEmailSnapshot" TEXT NOT NULL,
    "buyerNameSnapshot" TEXT,
    "sellerName" TEXT NOT NULL,
    "sellerSupportEmail" TEXT,
    "sellerStripeAccountId" TEXT,
    "feePolicyVersion" INTEGER,
    "stripeSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "requiresCompensationReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "CommerceOrder_pkey" PRIMARY KEY ("id"),
    -- One buyer: never both a member and a guest, and a membership never a guest.
    CONSTRAINT "CommerceOrder_buyer_chk" CHECK (NOT ("userId" IS NOT NULL AND "guestIdentityId" IS NOT NULL) AND ("kind" = 'merchandise' OR "guestIdentityId" IS NULL)),
    CONSTRAINT "CommerceOrder_amounts_chk" CHECK ("totalAmount" >= 0 AND "feeAmount" >= 0 AND "feeAmount" <= "totalAmount"),
    CONSTRAINT "CommerceOrder_free_chk" CHECK ("paymentKind" <> 'free' OR ("totalAmount" = 0 AND "feeAmount" = 0 AND "stripeSessionId" IS NULL)),
    CONSTRAINT "CommerceOrder_fulfilled_chk" CHECK ("fulfilledAt" IS NULL OR "status" = 'paid'),
    CONSTRAINT "CommerceOrder_version_chk" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "CommerceOrder_stripeSessionId_key" ON "CommerceOrder"("stripeSessionId");
CREATE UNIQUE INDEX "CommerceOrder_id_organisation_kind_key" ON "CommerceOrder"("id", "organisationId", "kind");
CREATE INDEX "CommerceOrder_organisationId_createdAt_id_idx" ON "CommerceOrder"("organisationId", "createdAt", "id");
CREATE INDEX "CommerceOrder_userId_createdAt_id_idx" ON "CommerceOrder"("userId", "createdAt", "id");
CREATE INDEX "CommerceOrder_guestIdentityId_idx" ON "CommerceOrder"("guestIdentityId");

ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_guestIdentityId_fkey" FOREIGN KEY ("guestIdentityId") REFERENCES "GuestIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CommerceOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "kind" "CommerceKind" NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitAmount" INTEGER NOT NULL,
    "lineAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "variantSnapshot" TEXT,
    "termStartsAt" TIMESTAMP(3),
    "termEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceOrderLine_pkey" PRIMARY KEY ("id"),
    -- At most 10 lines of at most 10 units; a membership line is one term.
    CONSTRAINT "CommerceOrderLine_line_number_chk" CHECK ("lineNumber" BETWEEN 1 AND 10),
    CONSTRAINT "CommerceOrderLine_quantity_chk" CHECK ("quantity" BETWEEN 1 AND 10 AND ("kind" = 'merchandise' OR "quantity" = 1)),
    CONSTRAINT "CommerceOrderLine_amount_chk" CHECK ("unitAmount" >= 0 AND "lineAmount" = "quantity" * "unitAmount"),
    CONSTRAINT "CommerceOrderLine_name_chk" CHECK (char_length("nameSnapshot") BETWEEN 1 AND 200),
    CONSTRAINT "CommerceOrderLine_term_chk" CHECK ("kind" <> 'membership' OR ("termStartsAt" IS NOT NULL AND "termEndsAt" IS NOT NULL AND "termEndsAt" > "termStartsAt"))
);

CREATE UNIQUE INDEX "CommerceOrderLine_orderId_lineNumber_key" ON "CommerceOrderLine"("orderId", "lineNumber");
ALTER TABLE "CommerceOrderLine" ADD CONSTRAINT "CommerceOrderLine_orderId_organisationId_kind_fkey" FOREIGN KEY ("orderId", "organisationId", "kind") REFERENCES "CommerceOrder"("id", "organisationId", "kind") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CommerceLifecycleEvent" (
    "id" TEXT NOT NULL,
    "commerceOrderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "CommerceLifecycleEventType" NOT NULL,
    "source" "OrderLifecycleSource" NOT NULL,
    "actorUserId" TEXT,
    "stripeEventId" TEXT,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus",
    "reason" TEXT,
    "facts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceLifecycleEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommerceLifecycleEvent_sequence_chk" CHECK ("sequence" >= 1)
);

CREATE UNIQUE INDEX "CommerceLifecycleEvent_commerceOrderId_sequence_key" ON "CommerceLifecycleEvent"("commerceOrderId", "sequence");
ALTER TABLE "CommerceLifecycleEvent" ADD CONSTRAINT "CommerceLifecycleEvent_commerceOrderId_fkey" FOREIGN KEY ("commerceOrderId") REFERENCES "CommerceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommerceLifecycleEvent" ADD CONSTRAINT "CommerceLifecycleEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Purchase facts never change once written: lines and history are append-only,
-- and an order's family, society, buyer, seller and money are fixed.
CREATE FUNCTION commerce_append_only() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER "CommerceOrderLine_append_only" BEFORE UPDATE ON "CommerceOrderLine" FOR EACH ROW EXECUTE FUNCTION commerce_append_only();
CREATE TRIGGER "CommerceLifecycleEvent_append_only" BEFORE UPDATE ON "CommerceLifecycleEvent" FOR EACH ROW EXECUTE FUNCTION commerce_append_only();

CREATE FUNCTION preserve_commerce_order_snapshot() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."organisationId", NEW."kind", NEW."guestIdentityId", NEW."paymentKind", NEW."currency", NEW."totalAmount", NEW."feeAmount",
         NEW."buyerEmailSnapshot", NEW."buyerNameSnapshot", NEW."sellerName", NEW."sellerSupportEmail", NEW."sellerStripeAccountId", NEW."feePolicyVersion", NEW."createdAt")
     IS DISTINCT FROM
     ROW(OLD."organisationId", OLD."kind", OLD."guestIdentityId", OLD."paymentKind", OLD."currency", OLD."totalAmount", OLD."feeAmount",
         OLD."buyerEmailSnapshot", OLD."buyerNameSnapshot", OLD."sellerName", OLD."sellerSupportEmail", OLD."sellerStripeAccountId", OLD."feePolicyVersion", OLD."createdAt") THEN
    RAISE EXCEPTION 'Commerce purchase facts are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CommerceOrder_preserve_snapshot" BEFORE UPDATE ON "CommerceOrder" FOR EACH ROW EXECUTE FUNCTION preserve_commerce_order_snapshot();

-- A checkout attempt buys a ticket order or a commerce order, never both.
ALTER TABLE "CheckoutAttempt" ADD COLUMN "commerceOrderId" TEXT,
  ADD CONSTRAINT "CheckoutAttempt_commerce_order_chk" CHECK ("commerceOrderId" IS NULL OR "family" <> 'ticket');
CREATE UNIQUE INDEX "CheckoutAttempt_commerceOrderId_key" ON "CheckoutAttempt"("commerceOrderId");
ALTER TABLE "CheckoutAttempt" ADD CONSTRAINT "CheckoutAttempt_commerceOrderId_fkey" FOREIGN KEY ("commerceOrderId") REFERENCES "CommerceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
