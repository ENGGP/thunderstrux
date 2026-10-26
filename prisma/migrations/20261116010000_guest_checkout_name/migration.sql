-- A guest gives their name with their email, so door staff can find them by
-- name (2026-10-26 audit). It is kept on the checkout link, not the email's
-- identity: an unverified request can't rename someone else's address, and
-- the name reaches an order only through the link the address owner opened.
-- Additive.
ALTER TABLE "GuestAccessGrant" ADD COLUMN "buyerFirstName" TEXT, ADD COLUMN "buyerLastName" TEXT;
