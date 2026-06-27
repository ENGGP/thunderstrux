CREATE TYPE "OrganisationStaffRole" AS ENUM (
  'owner',
  'admin',
  'event_manager',
  'finance_manager',
  'check_in_staff'
);

CREATE TYPE "OrganisationStaffStatus" AS ENUM (
  'invited',
  'active',
  'revoked'
);

CREATE TABLE "OrganisationStaff" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "OrganisationStaffRole" NOT NULL,
  "status" "OrganisationStaffStatus" NOT NULL DEFAULT 'active',
  "invitedById" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revokedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrganisationStaff_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganisationStaffInvite" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "OrganisationStaffRole" NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "invitedById" TEXT NOT NULL,
  "acceptedById" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrganisationStaffInvite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganisationStaff_organisationId_userId_key"
ON "OrganisationStaff"("organisationId", "userId");

CREATE INDEX "OrganisationStaff_userId_status_idx"
ON "OrganisationStaff"("userId", "status");

CREATE INDEX "OrganisationStaff_organisationId_role_status_idx"
ON "OrganisationStaff"("organisationId", "role", "status");

CREATE INDEX "OrganisationStaff_invitedById_idx"
ON "OrganisationStaff"("invitedById");

CREATE INDEX "OrganisationStaff_revokedById_idx"
ON "OrganisationStaff"("revokedById");

CREATE UNIQUE INDEX "OrganisationStaffInvite_tokenHash_key"
ON "OrganisationStaffInvite"("tokenHash");

CREATE INDEX "OrganisationStaffInvite_organisationId_email_idx"
ON "OrganisationStaffInvite"("organisationId", "email");

CREATE INDEX "OrganisationStaffInvite_expiresAt_idx"
ON "OrganisationStaffInvite"("expiresAt");

CREATE INDEX "OrganisationStaffInvite_invitedById_idx"
ON "OrganisationStaffInvite"("invitedById");

CREATE INDEX "OrganisationStaffInvite_acceptedById_idx"
ON "OrganisationStaffInvite"("acceptedById");

CREATE INDEX "AuditLog_organisationId_createdAt_idx"
ON "AuditLog"("organisationId", "createdAt");

CREATE INDEX "AuditLog_actorUserId_createdAt_idx"
ON "AuditLog"("actorUserId", "createdAt");

CREATE INDEX "AuditLog_action_idx"
ON "AuditLog"("action");

ALTER TABLE "OrganisationStaff"
ADD CONSTRAINT "OrganisationStaff_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganisationStaff"
ADD CONSTRAINT "OrganisationStaff_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganisationStaff"
ADD CONSTRAINT "OrganisationStaff_invitedById_fkey"
FOREIGN KEY ("invitedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrganisationStaff"
ADD CONSTRAINT "OrganisationStaff_revokedById_fkey"
FOREIGN KEY ("revokedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrganisationStaffInvite"
ADD CONSTRAINT "OrganisationStaffInvite_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganisationStaffInvite"
ADD CONSTRAINT "OrganisationStaffInvite_invitedById_fkey"
FOREIGN KEY ("invitedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrganisationStaffInvite"
ADD CONSTRAINT "OrganisationStaffInvite_acceptedById_fkey"
FOREIGN KEY ("acceptedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditLog"
ADD CONSTRAINT "AuditLog_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditLog"
ADD CONSTRAINT "AuditLog_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "OrganisationStaff" (
  "id",
  "organisationId",
  "userId",
  "role",
  "status",
  "acceptedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  'staff_' || substr(md5("id" || "accountUserId" || now()::text), 1, 24),
  "id",
  "accountUserId",
  'owner'::"OrganisationStaffRole",
  'active'::"OrganisationStaffStatus",
  now(),
  now(),
  now()
FROM "Organisation"
WHERE "accountUserId" IS NOT NULL
ON CONFLICT ("organisationId", "userId") DO NOTHING;
