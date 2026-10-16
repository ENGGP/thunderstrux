-- T16a: verified guest email access. Additive: new tables, nullable links, and
-- one more accepted buyer provenance.
CREATE TABLE "GuestIdentity" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestIdentity_pkey" PRIMARY KEY ("id"),
    -- Stored normalised, so one address is one identity.
    CONSTRAINT "GuestIdentity_email_normalised_chk" CHECK ("email" = lower(btrim("email")))
);

CREATE UNIQUE INDEX "GuestIdentity_email_key" ON "GuestIdentity"("email");

CREATE TABLE "GuestAccessGrant" (
    "id" TEXT NOT NULL,
    "guestIdentityId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenDigest" TEXT NOT NULL,
    "callbackPath" TEXT NOT NULL DEFAULT '/events',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "sessionDigest" TEXT,
    "sessionExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestAccessGrant_pkey" PRIMARY KEY ("id"),
    -- A session exists only for a redeemed link, and always expires.
    CONSTRAINT "GuestAccessGrant_session_chk" CHECK (
      ("sessionDigest" IS NULL AND "sessionExpiresAt" IS NULL)
      OR ("sessionDigest" IS NOT NULL AND "sessionExpiresAt" IS NOT NULL AND "consumedAt" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "GuestAccessGrant_tokenDigest_key" ON "GuestAccessGrant"("tokenDigest");
CREATE UNIQUE INDEX "GuestAccessGrant_sessionDigest_key" ON "GuestAccessGrant"("sessionDigest");
CREATE INDEX "GuestAccessGrant_guestIdentityId_purpose_createdAt_idx" ON "GuestAccessGrant"("guestIdentityId", "purpose", "createdAt");
CREATE INDEX "GuestAccessGrant_expiresAt_idx" ON "GuestAccessGrant"("expiresAt");

ALTER TABLE "GuestAccessGrant" ADD CONSTRAINT "GuestAccessGrant_guestIdentityId_fkey" FOREIGN KEY ("guestIdentityId") REFERENCES "GuestIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Order" ADD COLUMN "guestIdentityId" TEXT;
CREATE INDEX "Order_guestIdentityId_idx" ON "Order"("guestIdentityId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_guestIdentityId_fkey" FOREIGN KEY ("guestIdentityId") REFERENCES "GuestIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationOutbox" ADD COLUMN "guestAccessGrantId" TEXT;
CREATE INDEX "NotificationOutbox_guestAccessGrantId_idx" ON "NotificationOutbox"("guestAccessGrantId");
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_guestAccessGrantId_fkey" FOREIGN KEY ("guestAccessGrantId") REFERENCES "GuestAccessGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A guest purchase (T16b) captures the buyer as a verified guest.
ALTER TABLE "Order" DROP CONSTRAINT "Order_buyer_capture_check";
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyer_capture_check" CHECK (
  ("buyerIdentityCapturedAt" IS NULL AND "buyerIdentityProvenance" IS NULL AND "buyerEmailSnapshot" IS NULL AND "buyerFirstNameSnapshot" IS NULL AND "buyerLastNameSnapshot" IS NULL AND "buyerDisplayNameSnapshot" IS NULL)
  OR ("buyerIdentityCapturedAt" IS NOT NULL AND "buyerEmailSnapshot" IS NOT NULL AND "buyerIdentityProvenance" IS NOT NULL AND "buyerIdentityProvenance" IN ('current_account_at_capture', 'purchase', 'verified_guest'))
);
