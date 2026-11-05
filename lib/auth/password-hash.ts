import { compare, hash } from "bcryptjs";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { logWarn } from "@/lib/ops/logger";

// SEC-019: bcryptjs cost-12 hashing takes about 0.25 s of CPU. On the event loop
// that slowed every other request while sign-ins ran, so it runs on a small pool
// of worker threads, with the same hashes. Past this many at once the next is still
// refused with 503 and a short Retry-After, so a flood can't queue without limit.
// shortcut: per process, not per host; enough for one app container, revisit with more replicas.
export const maxPasswordWork = 8;
export const passwordBusyRetrySeconds = 5;
let active = 0;

export class PasswordBusyError extends Error {
  constructor() {
    super("Too many sign-ins at once. Try again in a few seconds.");
    this.name = "PasswordBusyError";
  }
}

export function passwordWorkBusy() {
  return active >= maxPasswordWork;
}

async function gated<T>(work: () => Promise<T>) {
  if (passwordWorkBusy()) throw new PasswordBusyError();
  active += 1;
  try {
    return await work();
  } finally {
    active -= 1;
  }
}

// A thread that died took its job with it; that job is redone on the event loop.
class PasswordWorkerStopped extends Error {}

type Job = { op: "hash"; password: string } | { op: "compare"; password: string; digest: string };
type Pooled = { worker: Worker; pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }> };

// Plain CommonJS, so it needs no build step: bcryptjs is a server-external package
// (next.config.ts), so it is a real file in node_modules here and in the standalone image.
const workerSource = `
const { parentPort, workerData } = require("node:worker_threads");
const bcrypt = require(workerData.bcrypt);
parentPort.on("message", ({ id, op, password, digest }) => {
  (op === "hash" ? bcrypt.hash(password, 12) : bcrypt.compare(password, digest)).then(
    (result) => parentPort.postMessage({ id, result }),
    (error) => parentPort.postMessage({ id, error: String((error && error.message) || error) })
  );
});`;
const poolSize = Math.max(1, Math.min(4, availableParallelism() - 1));
const pool: Pooled[] = [];
let nextId = 0;
let unavailable = false;

function spawn(): Pooled | null {
  try {
    const bcrypt = createRequire(join(process.cwd(), "package.json")).resolve("bcryptjs");
    const worker = new Worker(workerSource, { eval: true, workerData: { bcrypt } });
    const pooled: Pooled = { worker, pending: new Map() };
    worker.unref();
    worker.on("message", ({ id, result, error }: { id: number; result?: unknown; error?: string }) => {
      const job = pooled.pending.get(id);
      if (!job) return;
      pooled.pending.delete(id);
      if (pooled.pending.size === 0) worker.unref();
      if (error === undefined) job.resolve(result); else job.reject(new Error(error));
    });
    // A thread that dies fails what it held; the next job starts a fresh one.
    const fail = (error: unknown) => {
      if (pool.includes(pooled)) pool.splice(pool.indexOf(pooled), 1);
      logWarn("password_hash.worker_stopped", { error });
      for (const job of pooled.pending.values()) job.reject(new PasswordWorkerStopped());
      pooled.pending.clear();
    };
    worker.on("error", fail);
    worker.on("exit", (code) => { if (pool.includes(pooled)) fail(new Error(`Password worker exited with ${code}`)); });
    return pooled;
  } catch (error) {
    unavailable = true;
    logWarn("password_hash.worker_unavailable", { error });
    return null;
  }
}

function offThread<T>(job: Job, inline: () => Promise<T>): Promise<T> {
  if (unavailable) return inline();
  let target = pool.find((item) => item.pending.size === 0);
  if (!target && pool.length < poolSize) {
    const fresh = spawn();
    if (!fresh) return inline();
    pool.push(fresh);
    target = fresh;
  }
  target ??= pool.reduce((least, item) => (item.pending.size < least.pending.size ? item : least));
  const id = nextId++;
  const pooled = target;
  return new Promise<T>((resolve, reject) => {
    pooled.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    // Held while a job runs, so a script awaiting a hash doesn't exit first.
    pooled.worker.ref();
    pooled.worker.postMessage({ id, ...job });
  }).catch((error: unknown) => (error instanceof PasswordWorkerStopped ? inline() : Promise.reject(error)));
}

export const comparePassword = (password: string, digest: string) =>
  gated(() => offThread<boolean>({ op: "compare", password, digest }, () => compare(password, digest)));
export const hashPassword = (password: string) =>
  gated(() => offThread<string>({ op: "hash", password }, () => hash(password, 12)));
