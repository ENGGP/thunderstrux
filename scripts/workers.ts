import { prisma } from "@/lib/db";
import { readQueues, readWorkers } from "@/lib/ops/monitor";
import { ALL_WORKERS, scheduledWorkers } from "@/lib/ops/worker";

// T42: pause and resume scheduled jobs, and show their state.
//   status
//   pause <job|all> --reason="Restoring backup"
//   resume <job|all>
// A paused job's runs exit at once without work. Pausing doesn't stop a run in
// progress: wait until status shows it isn't running before a restore.
async function main() {
  const [command, target] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const reason = process.argv.find((arg) => arg.startsWith("--reason="))?.slice("--reason=".length);
  const names: string[] = [ALL_WORKERS, ...scheduledWorkers];
  if (command === "pause" || command === "resume") {
    if (!target || !names.includes(target)) throw new Error(`Name a job: ${names.join(", ")}`);
    if (command === "pause" && !reason?.trim()) throw new Error("Give a --reason for the pause");
    const data = command === "pause" ? { pausedAt: new Date(), pauseReason: reason!.trim().slice(0, 200) } : { pausedAt: null, pauseReason: null };
    await prisma.workerLease.upsert({ where: { name: target }, create: { name: target, ...data }, update: data });
    console.log(JSON.stringify({ [command === "pause" ? "paused" : "resumed"]: target }));
    return;
  }
  if (command !== "status") throw new Error("Usage: workers status | pause <job|all> --reason=... | resume <job|all>");
  const all = await prisma.workerLease.findUnique({ where: { name: ALL_WORKERS } });
  console.log(JSON.stringify({ allPaused: all?.pausedAt ? { at: all.pausedAt, reason: all.pauseReason } : false, workers: await readWorkers(), queues: await readQueues() }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Workers command failed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
