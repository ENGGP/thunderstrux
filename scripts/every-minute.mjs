// T42: run one bounded worker command on a schedule, never overlapping itself.
//   node scripts/every-minute.mjs scripts/process-email-outbox.mjs [args...]
// Each run starts WORKER_INTERVAL_SECONDS (60) after the previous one started,
// or as soon as it finishes if it ran longer. The command keeps its own
// timeout and database lease (lib/ops/worker.ts); this loop also kills a run
// that outlives that timeout by a minute. SIGTERM stops the loop after the
// current run, so a stop never cuts a batch short.
import { spawn } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("Give the worker command to schedule");
const intervalMs = Number(process.env.WORKER_INTERVAL_SECONDS ?? 60) * 1000;
const killAfterMs = (Number(process.env.WORKER_TIMEOUT_SECONDS ?? 300) + 60) * 1000;
if (!Number.isFinite(intervalMs) || intervalMs < 10_000) throw new Error("WORKER_INTERVAL_SECONDS must be at least 10");

let stopping = false;
let child;
let wake;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    // The current run finishes (within the container's stop grace); the loop then ends.
    stopping = true;
    wake?.();
  });
}

const log = (event, context = {}) => console.info(JSON.stringify({ level: "info", event, timestamp: new Date().toISOString(), service: "thunderstrux", command, ...context }));

while (!stopping) {
  const started = Date.now();
  const code = await new Promise((resolve) => {
    child = spawn(process.execPath, [command, ...args], { stdio: "inherit" });
    const guard = setTimeout(() => { log("schedule.run_killed", { afterMs: killAfterMs }); child.kill("SIGKILL"); }, killAfterMs);
    child.on("exit", (exitCode, signal) => { clearTimeout(guard); resolve(exitCode ?? (signal ? 1 : 0)); });
  });
  child = undefined;
  log("schedule.run_finished", { exitCode: code, durationMs: Date.now() - started });
  const wait = Math.max(0, started + intervalMs - Date.now());
  if (!stopping && wait) await new Promise((resolve) => { wake = resolve; setTimeout(resolve, wait); });
}
log("schedule.stopped");
