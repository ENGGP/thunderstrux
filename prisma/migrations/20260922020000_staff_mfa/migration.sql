CREATE TABLE "UserMfa" (
  "userId" TEXT NOT NULL,
  "encryptedSecret" TEXT,
  "pendingEncryptedSecret" TEXT,
  "pendingExpiresAt" TIMESTAMP(3),
  "enabledAt" TIMESTAMP(3),
  "lastAcceptedStep" BIGINT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserMfa_pkey" PRIMARY KEY ("userId")
);
CREATE TABLE "MfaRecoveryCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "MfaGrant" (
  "sessionDigest" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MfaGrant_pkey" PRIMARY KEY ("sessionDigest")
);
CREATE UNIQUE INDEX "MfaRecoveryCode_codeHash_key" ON "MfaRecoveryCode"("codeHash");
CREATE INDEX "MfaRecoveryCode_userId_idx" ON "MfaRecoveryCode"("userId");
CREATE INDEX "MfaGrant_userId_expiresAt_idx" ON "MfaGrant"("userId", "expiresAt");
CREATE INDEX "MfaGrant_expiresAt_idx" ON "MfaGrant"("expiresAt");
ALTER TABLE "UserMfa" ADD CONSTRAINT "UserMfa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MfaRecoveryCode" ADD CONSTRAINT "MfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MfaGrant" ADD CONSTRAINT "MfaGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
