-- T54: the platform admin portal's foundation. Additive: two new tables, two
-- enums and one nullable column. Older code ignores all of it.

CREATE TYPE "PlatformOperatorRole" AS ENUM ('support', 'admin');
CREATE TYPE "PlatformOperatorStatus" AS ENUM ('active', 'revoked');

ALTER TABLE "User" ADD COLUMN "lastSignInAt" TIMESTAMP(3);

CREATE TABLE "PlatformOperator" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PlatformOperatorRole" NOT NULL,
    "status" "PlatformOperatorStatus" NOT NULL DEFAULT 'active',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT NOT NULL,
    "note" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformOperator_pkey" PRIMARY KEY ("id"),
    -- A revoked row says when; an active one has no revocation.
    CONSTRAINT "PlatformOperator_revocation_chk" CHECK (("status" = 'revoked') = ("revokedAt" IS NOT NULL))
);

CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "operatorRole" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "organisationId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlatformAuditLog_reason_chk" CHECK ("reason" IS NULL OR char_length("reason") BETWEEN 8 AND 500),
    -- Only the CLI (pnpm ops:operator) acts without a signed-in operator.
    CONSTRAINT "PlatformAuditLog_actor_chk" CHECK ("actorUserId" IS NOT NULL OR "action" IN ('platform.operator_granted', 'platform.operator_role_changed', 'platform.operator_revoked'))
);

CREATE UNIQUE INDEX "PlatformOperator_userId_key" ON "PlatformOperator"("userId");
CREATE INDEX "PlatformOperator_status_role_idx" ON "PlatformOperator"("status", "role");
CREATE INDEX "PlatformAuditLog_createdAt_idx" ON "PlatformAuditLog"("createdAt");
CREATE INDEX "PlatformAuditLog_actorUserId_createdAt_idx" ON "PlatformAuditLog"("actorUserId", "createdAt");
CREATE INDEX "PlatformAuditLog_targetType_targetId_createdAt_idx" ON "PlatformAuditLog"("targetType", "targetId", "createdAt");
CREATE INDEX "PlatformAuditLog_organisationId_idx" ON "PlatformAuditLog"("organisationId");

ALTER TABLE "PlatformOperator" ADD CONSTRAINT "PlatformOperator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformOperator" ADD CONSTRAINT "PlatformOperator_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlatformAuditLog" ADD CONSTRAINT "PlatformAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformAuditLog" ADD CONSTRAINT "PlatformAuditLog_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The trail can't be edited, and only a view or search row older than two
-- years can be deleted (the notifications job prunes them). A deleted society
-- clears organisationId through its foreign key; that one update is allowed.
-- The database owner can still drop this trigger, so the alert webhook is the
-- copy kept outside the database.
CREATE FUNCTION platform_audit_append_only() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW."id", NEW."actorUserId", NEW."operatorRole", NEW."action", NEW."targetType", NEW."targetId", NEW."reason", NEW."metadata", NEW."createdAt")
       IS DISTINCT FROM
       ROW(OLD."id", OLD."actorUserId", OLD."operatorRole", OLD."action", OLD."targetType", OLD."targetId", OLD."reason", OLD."metadata", OLD."createdAt")
       OR NEW."organisationId" IS NOT NULL AND NEW."organisationId" IS DISTINCT FROM OLD."organisationId" THEN
      RAISE EXCEPTION 'PlatformAuditLog rows are immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."action" IN ('platform.viewed', 'platform.searched') AND OLD."createdAt" < now() - interval '2 years' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'PlatformAuditLog rows can''t be deleted';
END;
$$;
CREATE TRIGGER "PlatformAuditLog_append_only" BEFORE UPDATE OR DELETE ON "PlatformAuditLog" FOR EACH ROW EXECUTE FUNCTION platform_audit_append_only();
