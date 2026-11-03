-- T55: the platform admin portal's controls. Additive: one table, two enums and
-- five nullable Organisation columns. Older code ignores them, except that an
-- older payouts worker would pay a held or restricted society: pause the
-- `refunds` job before rolling back across this migration.

CREATE TYPE "PlatformRecoveryKind" AS ENUM ('mfa_reset', 'ownership');
CREATE TYPE "PlatformRecoveryStatus" AS ENUM ('pending', 'completed', 'cancelled');

ALTER TABLE "Organisation" ADD COLUMN "restrictedAt" TIMESTAMP(3),
  ADD COLUMN "restrictionReason" TEXT,
  ADD COLUMN "payoutsHeldAt" TIMESTAMP(3),
  ADD COLUMN "payoutsHeldUntil" TIMESTAMP(3),
  ADD COLUMN "payoutsHeldReason" TEXT;

CREATE TABLE "PlatformRecoveryRequest" (
    "id" TEXT NOT NULL,
    "kind" "PlatformRecoveryKind" NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "organisationId" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "executeAfter" TIMESTAMP(3) NOT NULL,
    "status" "PlatformRecoveryStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,

    CONSTRAINT "PlatformRecoveryRequest_pkey" PRIMARY KEY ("id"),
    -- An ownership recovery names its society; an authenticator reset doesn't.
    CONSTRAINT "PlatformRecoveryRequest_society_chk" CHECK (("kind" = 'ownership') = ("organisationId" IS NOT NULL)),
    CONSTRAINT "PlatformRecoveryRequest_reason_chk" CHECK (char_length("reason") BETWEEN 8 AND 500),
    CONSTRAINT "PlatformRecoveryRequest_evidence_chk" CHECK (char_length("evidence") BETWEEN 8 AND 1000),
    CONSTRAINT "PlatformRecoveryRequest_outcome_chk" CHECK (("status" = 'completed') = ("completedAt" IS NOT NULL) AND ("status" = 'cancelled') = ("cancelledAt" IS NOT NULL))
);

-- One open request per person's authenticator, and one per society's ownership.
CREATE UNIQUE INDEX "PlatformRecoveryRequest_pending_mfa_key" ON "PlatformRecoveryRequest"("targetUserId") WHERE "status" = 'pending' AND "kind" = 'mfa_reset';
CREATE UNIQUE INDEX "PlatformRecoveryRequest_pending_ownership_key" ON "PlatformRecoveryRequest"("organisationId") WHERE "status" = 'pending' AND "kind" = 'ownership';
CREATE INDEX "PlatformRecoveryRequest_status_executeAfter_idx" ON "PlatformRecoveryRequest"("status", "executeAfter");
CREATE INDEX "PlatformRecoveryRequest_targetUserId_idx" ON "PlatformRecoveryRequest"("targetUserId");
CREATE INDEX "PlatformRecoveryRequest_organisationId_idx" ON "PlatformRecoveryRequest"("organisationId");

ALTER TABLE "PlatformRecoveryRequest" ADD CONSTRAINT "PlatformRecoveryRequest_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformRecoveryRequest" ADD CONSTRAINT "PlatformRecoveryRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformRecoveryRequest" ADD CONSTRAINT "PlatformRecoveryRequest_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlatformRecoveryRequest" ADD CONSTRAINT "PlatformRecoveryRequest_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The account notices support's changes leave in the person's security history.
ALTER TABLE "AccountSecurityEvent" DROP CONSTRAINT "AccountSecurityEvent_type_check";
ALTER TABLE "AccountSecurityEvent" ADD CONSTRAINT "AccountSecurityEvent_type_check" CHECK ("type" IN ('password_reset', 'password_changed', 'email_change_requested', 'email_changed', 'email_change_cancelled', 'account_closed',
  'support_signed_out', 'support_disabled', 'support_reenabled', 'support_mfa_reset_requested', 'support_mfa_reset_completed', 'support_mfa_reset_cancelled'));
