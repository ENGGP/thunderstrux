-- Account role groundwork for the member vs organisation product model.
CREATE TYPE "AccountRole" AS ENUM ('member', 'organisation');

ALTER TABLE "User"
ADD COLUMN "accountRole" "AccountRole" NOT NULL DEFAULT 'member',
ADD COLUMN "firstName" TEXT,
ADD COLUMN "lastName" TEXT,
ADD COLUMN "displayName" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "studentNumber" TEXT,
ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);

ALTER TABLE "Organisation"
ADD COLUMN "accountUserId" TEXT;

CREATE INDEX "User_accountRole_idx" ON "User"("accountRole");
CREATE UNIQUE INDEX "Organisation_accountUserId_key" ON "Organisation"("accountUserId");
CREATE INDEX "Organisation_accountUserId_idx" ON "Organisation"("accountUserId");

ALTER TABLE "Organisation"
ADD CONSTRAINT "Organisation_accountUserId_fkey"
FOREIGN KEY ("accountUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
