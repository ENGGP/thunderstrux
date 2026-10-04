import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import test from "node:test";

test("occupied E2E port is refused before creating a run or invoking Docker", async () => {
  const listener = createServer();
  const owned = await new Promise((accept, reject) => {
    listener.once("error", error => error.code === "EADDRINUSE" ? accept(false) : reject(error));
    listener.listen(3100, "127.0.0.1", () => accept(true));
  });
  const runs = () => existsSync("tmp/e2e") ? readdirSync("tmp/e2e").sort() : [];
  const before = runs();
  try {
    const result = spawnSync(process.execPath, [resolve("scripts/run-e2e.mjs")], {
      env: { ...process.env, PATH: "", Path: "" }, encoding: "utf8", timeout: 10000
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Port 3100 is occupied; existing server will not be reused/);
    assert.doesNotMatch(result.stderr, /ENOENT|Docker command failed/);
    assert.deepEqual(runs(), before);
    if (owned) assert.equal(listener.listening, true);
  } finally {
    if (owned) await new Promise((accept, reject) => listener.close(error => error ? reject(error) : accept()));
  }
});
