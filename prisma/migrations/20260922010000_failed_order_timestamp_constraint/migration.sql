-- Every failed order write path records failedAt. Reject future invalid rows and
-- stop deployment if historical rows violate the same policy.
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_failed_requires_failedAt_chk"
    CHECK ("status" <> 'failed'::"OrderStatus" OR "failedAt" IS NOT NULL);
