-- T22: fixed-term membership plans, and the grants T23 issues from them. Additive.
CREATE TYPE "MembershipPlanStatus" AS ENUM ('draft', 'published', 'archived');
-- The whitelist of rights a plan can carry (database spec 8.1); T24b reads them.
CREATE TYPE "MembershipEntitlement" AS ENUM ('member_prices', 'members_only_events');

CREATE TABLE "MembershipProduct" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priceAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'aud',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "entitlements" "MembershipEntitlement"[] NOT NULL DEFAULT ARRAY[]::"MembershipEntitlement"[],
    "entitlementVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "MembershipPlanStatus" NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipProduct_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MembershipProduct_name_chk" CHECK (char_length("name") BETWEEN 1 AND 120),
    CONSTRAINT "MembershipProduct_description_chk" CHECK (char_length("description") <= 2000),
    CONSTRAINT "MembershipProduct_price_chk" CHECK ("priceAmount" >= 0 AND "currency" = 'aud'),
    -- Terms are half-open [startsAt, endsAt).
    CONSTRAINT "MembershipProduct_term_chk" CHECK ("endsAt" > "startsAt"),
    CONSTRAINT "MembershipProduct_version_chk" CHECK ("version" >= 1 AND "entitlementVersion" >= 1),
    CONSTRAINT "MembershipProduct_published_chk" CHECK ("status" <> 'published' OR "publishedAt" IS NOT NULL),
    CONSTRAINT "MembershipProduct_archived_chk" CHECK (("status" = 'archived') = ("archivedAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "MembershipProduct_id_organisationId_key" ON "MembershipProduct"("id", "organisationId");
CREATE INDEX "MembershipProduct_organisationId_status_startsAt_id_idx" ON "MembershipProduct"("organisationId", "status", "startsAt", "id");
ALTER TABLE "MembershipProduct" ADD CONSTRAINT "MembershipProduct_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A membership line names the plan it bought, in the same society.
CREATE UNIQUE INDEX "CommerceOrderLine_id_organisationId_key" ON "CommerceOrderLine"("id", "organisationId");
ALTER TABLE "CommerceOrderLine" ADD COLUMN "membershipProductId" TEXT,
  ADD CONSTRAINT "CommerceOrderLine_membership_product_chk" CHECK ("membershipProductId" IS NULL OR "kind" = 'membership');
CREATE INDEX "CommerceOrderLine_membershipProductId_idx" ON "CommerceOrderLine"("membershipProductId");
ALTER TABLE "CommerceOrderLine" ADD CONSTRAINT "CommerceOrderLine_membershipProductId_organisationId_fkey" FOREIGN KEY ("membershipProductId", "organisationId") REFERENCES "MembershipProduct"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MembershipGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "membershipProductId" TEXT NOT NULL,
    "commerceOrderLineId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "entitlements" "MembershipEntitlement"[] NOT NULL,
    "entitlementVersion" INTEGER NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revocationReason" TEXT,

    CONSTRAINT "MembershipGrant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MembershipGrant_term_chk" CHECK ("endsAt" > "startsAt"),
    CONSTRAINT "MembershipGrant_revocation_chk" CHECK (("revokedAt" IS NULL) = ("revocationReason" IS NULL) AND ("revokedByUserId" IS NULL OR "revokedAt" IS NOT NULL))
);

-- Exactly one grant per purchased line.
CREATE UNIQUE INDEX "MembershipGrant_commerceOrderLineId_key" ON "MembershipGrant"("commerceOrderLineId");
CREATE UNIQUE INDEX "MembershipGrant_commerceOrderLineId_organisationId_key" ON "MembershipGrant"("commerceOrderLineId", "organisationId");
CREATE INDEX "MembershipGrant_userId_organisationId_startsAt_idx" ON "MembershipGrant"("userId", "organisationId", "startsAt");
CREATE INDEX "MembershipGrant_organisationId_startsAt_id_idx" ON "MembershipGrant"("organisationId", "startsAt", "id");
CREATE INDEX "MembershipGrant_membershipProductId_idx" ON "MembershipGrant"("membershipProductId");
ALTER TABLE "MembershipGrant" ADD CONSTRAINT "MembershipGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MembershipGrant" ADD CONSTRAINT "MembershipGrant_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MembershipGrant" ADD CONSTRAINT "MembershipGrant_membershipProductId_organisationId_fkey" FOREIGN KEY ("membershipProductId", "organisationId") REFERENCES "MembershipProduct"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MembershipGrant" ADD CONSTRAINT "MembershipGrant_commerceOrderLineId_organisationId_fkey" FOREIGN KEY ("commerceOrderLineId", "organisationId") REFERENCES "CommerceOrderLine"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MembershipGrant" ADD CONSTRAINT "MembershipGrant_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A plan never moves society, and once a line or grant names it, what was
-- bought (name, term, price, rights) is fixed. The service checks first; this
-- is the backstop.
CREATE FUNCTION preserve_sold_membership_product() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."organisationId" IS DISTINCT FROM OLD."organisationId" THEN
    RAISE EXCEPTION 'A membership plan cannot move society';
  END IF;
  IF ROW(NEW."name", NEW."priceAmount", NEW."currency", NEW."startsAt", NEW."endsAt", NEW."entitlements", NEW."entitlementVersion")
     IS DISTINCT FROM
     ROW(OLD."name", OLD."priceAmount", OLD."currency", OLD."startsAt", OLD."endsAt", OLD."entitlements", OLD."entitlementVersion")
     AND (EXISTS (SELECT 1 FROM "CommerceOrderLine" WHERE "membershipProductId" = OLD."id")
          OR EXISTS (SELECT 1 FROM "MembershipGrant" WHERE "membershipProductId" = OLD."id")) THEN
    RAISE EXCEPTION 'A sold membership plan is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "MembershipProduct_preserve_sold" BEFORE UPDATE ON "MembershipProduct" FOR EACH ROW EXECUTE FUNCTION preserve_sold_membership_product();

-- A grant's facts never change; it can only be revoked, once.
CREATE FUNCTION preserve_membership_grant() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."userId", NEW."organisationId", NEW."membershipProductId", NEW."commerceOrderLineId", NEW."startsAt", NEW."endsAt", NEW."entitlements", NEW."entitlementVersion", NEW."grantedAt")
     IS DISTINCT FROM
     ROW(OLD."userId", OLD."organisationId", OLD."membershipProductId", OLD."commerceOrderLineId", OLD."startsAt", OLD."endsAt", OLD."entitlements", OLD."entitlementVersion", OLD."grantedAt")
     OR (OLD."revokedAt" IS NOT NULL AND ROW(NEW."revokedAt", NEW."revocationReason") IS DISTINCT FROM ROW(OLD."revokedAt", OLD."revocationReason")) THEN
    RAISE EXCEPTION 'Membership grant facts are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "MembershipGrant_preserve_facts" BEFORE UPDATE ON "MembershipGrant" FOR EACH ROW EXECUTE FUNCTION preserve_membership_grant();
