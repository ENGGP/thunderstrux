CREATE TABLE "AccountSecurityEvent" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "type" TEXT NOT NULL,
  "authVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountSecurityEvent_type_check" CHECK ("type" IN ('password_reset', 'password_changed', 'email_change_requested', 'email_changed', 'email_change_cancelled', 'account_closed')),
  CONSTRAINT "AccountSecurityEvent_version_check" CHECK ("authVersion" >= 0)
);
CREATE INDEX "AccountSecurityEvent_userId_createdAt_idx" ON "AccountSecurityEvent"("userId", "createdAt");
