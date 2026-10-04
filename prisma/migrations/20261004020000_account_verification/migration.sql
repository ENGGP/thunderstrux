ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3), ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "disabledAt" TIMESTAMP(3);
ALTER TABLE "User" ADD CONSTRAINT "User_authVersion_nonnegative" CHECK ("authVersion" >= 0);
CREATE TABLE "AuthToken" (
  "id" TEXT PRIMARY KEY,
  "tokenHash" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "email" TEXT NOT NULL,
  "authVersion" INTEGER NOT NULL,
  "callbackPath" TEXT NOT NULL DEFAULT '/dashboard',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthToken_purpose_check" CHECK ("purpose" IN ('verify_account', 'reset_password', 'email_change')),
  CONSTRAINT "AuthToken_version_check" CHECK ("authVersion" >= 0)
);
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");
CREATE INDEX "AuthToken_userId_purpose_createdAt_idx" ON "AuthToken"("userId", "purpose", "createdAt");
CREATE INDEX "AuthToken_expiresAt_idx" ON "AuthToken"("expiresAt");
ALTER TABLE "NotificationOutbox" ADD COLUMN "authTokenId" TEXT REFERENCES "AuthToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "NotificationOutbox_authTokenId_idx" ON "NotificationOutbox"("authTokenId");
