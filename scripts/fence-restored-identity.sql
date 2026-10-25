-- SEC-023: a restored copy must not bring back sessions, MFA logins, links or
-- invitations that were ended after its restore point. Run inside the restored
-- database before it serves traffic (scripts/operations.mjs restore). Closures,
-- password and email changes and staff revocations made after the restore point
-- are re-applied by hand from the recovery runbook.
BEGIN;
-- Every signed-in session carries authVersion, so each one must sign in again.
UPDATE "User" SET "authVersion" = "authVersion" + 1;
-- Staff MFA logins are re-verified.
DELETE FROM "MfaGrant";
-- Verification, reset and email-change links issued before the restore point stop working.
UPDATE "AuthToken" SET "invalidatedAt" = now() WHERE "consumedAt" IS NULL AND "invalidatedAt" IS NULL;
-- Guest links and guest sessions end; guests ask for a new link.
UPDATE "GuestAccessGrant" SET "revokedAt" = now() WHERE "revokedAt" IS NULL;
-- Pending staff invitations are issued again if still wanted.
UPDATE "OrganisationStaffInvite" SET "revokedAt" = now() WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;
COMMIT;
