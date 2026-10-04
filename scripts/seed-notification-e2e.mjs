import { createJiti } from "jiti";
if (!/^p216-[a-f0-9]{24}$/.test(process.env.E2E_RUN_ID ?? "")) throw new Error("Isolated E2E run required");
const jiti = createJiti(import.meta.url, { alias: { "@/": `${process.cwd()}/` } });
const { prisma } = await jiti.import("../lib/db/index.ts");
const { enqueueNotification } = await jiti.import("../lib/email/notification-outbox.ts");
try {
  await prisma.$transaction(tx => enqueueNotification(tx, { eventKey: `e2e/${process.env.E2E_RUN_ID}`, recipient: "notification-e2e@example.com",
    template: "verify_account", payload: { message: "Verify your test account", link: "http://localhost:3100/verify-email#token=synthetic-e2e" } }));
} finally { await prisma.$disconnect(); }
