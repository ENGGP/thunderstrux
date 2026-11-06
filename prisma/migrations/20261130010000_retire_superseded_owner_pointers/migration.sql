-- SEC-080: the legacy creator pointer is ownership only while its holder owns. A staff row for
-- the holder that is not an active owner already supersedes it, so clearing it changes no
-- authority; it lets the demoted or revoked creator close their account or start a society.
UPDATE "Organisation" AS o
SET "accountUserId" = NULL
FROM "OrganisationStaff" AS s
WHERE s."organisationId" = o."id"
  AND s."userId" = o."accountUserId"
  AND NOT (s."role" = 'owner' AND s."status" = 'active');
