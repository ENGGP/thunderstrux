import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

test("readiness schema contract tracks the newest checked-in migration", async () => {
  const contract = JSON.parse(await readFile("config/schema-contract.json", "utf8"));
  const entries = await readdir("prisma/migrations", { withFileTypes: true });
  const newestMigration = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .at(-1);

  assert.equal(contract.requiredMigration, newestMigration);
});
