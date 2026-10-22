-- T38: History shows each staff action with the role the actor held when it
-- happened. A trigger records it on every new row, so no writer can forget;
-- rows written before this migration keep a null role.
ALTER TABLE "AuditLog" ADD COLUMN "actorRole" TEXT;

CREATE FUNCTION "AuditLog_actor_role"() RETURNS trigger AS $$
BEGIN
  IF NEW."actorUserId" IS NOT NULL AND NEW."actorRole" IS NULL THEN
    SELECT s."role"::text INTO NEW."actorRole"
    FROM "OrganisationStaff" s
    WHERE s."organisationId" = NEW."organisationId" AND s."userId" = NEW."actorUserId" AND s."status" = 'active'
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_actor_role" BEFORE INSERT ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION "AuditLog_actor_role"();

-- History pages filter one society by actor and by action family, newest first.
CREATE INDEX "AuditLog_organisationId_actorUserId_createdAt_idx" ON "AuditLog"("organisationId", "actorUserId", "createdAt");
