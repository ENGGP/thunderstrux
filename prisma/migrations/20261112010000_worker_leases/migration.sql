-- T42: one row per scheduled job (and "all"). A run takes the lease, so runs
-- never overlap; a crashed run's lease lapses at leasedUntil and the next run
-- reclaims it. pausedAt stops the job (or every job, on "all") until resumed,
-- for restores and reconciliation. Additive; older releases ignore it.
CREATE TABLE "WorkerLease" (
    "name" TEXT NOT NULL,
    "holder" TEXT,
    "leasedUntil" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "pauseReason" TEXT,
    "lastStartedAt" TIMESTAMP(3),
    "lastSucceededAt" TIMESTAMP(3),
    "lastFailedAt" TIMESTAMP(3),
    "lastDurationMs" INTEGER,
    "lastError" TEXT,
    "alertState" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerLease_pkey" PRIMARY KEY ("name"),
    CONSTRAINT "WorkerLease_duration_nonnegative_chk" CHECK ("lastDurationMs" IS NULL OR "lastDurationMs" >= 0)
);
