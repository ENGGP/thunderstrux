import { processTicketEmailOutboxBatch } from "@/lib/email/ticket-email-outbox";
import { runWorker } from "@/lib/ops/worker";

// T42: one run at a time, pausable, with a timeout and an alert on failure.
void runWorker("email-outbox", async () => ({ ...(await processTicketEmailOutboxBatch()) }));
