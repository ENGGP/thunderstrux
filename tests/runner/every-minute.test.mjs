import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// T42: the per-minute loop lets a run in progress finish when stopped, and
// doesn't start another.
// Windows has no SIGTERM handlers (kill is immediate); the baseline runs this on Linux.
test("stopping the schedule lets the current run finish and starts no other", { skip: process.platform === "win32" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "every-minute-"));
  try {
    const marks = join(dir, "marks.txt");
    const job = join(dir, "job.mjs");
    await writeFile(job, `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(marks)}, "start\\n");
setTimeout(() => appendFileSync(${JSON.stringify(marks)}, "end\\n"), 1000);
`);
    const loop = spawn(process.execPath, ["scripts/every-minute.mjs", job], { env: { ...process.env, WORKER_INTERVAL_SECONDS: "10" }, stdio: ["ignore", "pipe", "inherit"] });
    let output = "";
    loop.stdout.on("data", (chunk) => { output += chunk; });
    const exited = new Promise((resolve) => loop.on("exit", resolve));
    for (let attempt = 0; attempt < 50 && !(await readFile(marks, "utf8").catch(() => "")).includes("start"); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    loop.kill("SIGTERM");
    assert.equal(await exited, 0);
    assert.equal(await readFile(marks, "utf8"), "start\nend\n");
    assert.match(output, /"event":"schedule.run_finished".*"exitCode":0/);
    assert.match(output, /"event":"schedule.stopped"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the schedule refuses an interval under ten seconds", async () => {
  const loop = spawn(process.execPath, ["scripts/every-minute.mjs", "scripts/process-email-outbox.mjs"], { env: { ...process.env, WORKER_INTERVAL_SECONDS: "1" }, stdio: "ignore" });
  assert.notEqual(await new Promise((resolve) => loop.on("exit", resolve)), 0);
});
