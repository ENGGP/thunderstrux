import assert from "node:assert/strict";
import test from "node:test";
import { imageBudgets, validateReleaseManifest } from "../../scripts/release-pair.mjs";

// T43: a release manifest ties one revision to a web and an ops image within
// their size budgets and to the migration chain they were built with.
const MiB = 1024 * 1024;
const manifest = () => ({
  version: 1,
  revision: "a".repeat(40),
  createdAt: "2026-10-23T00:00:00.000Z",
  web: { ref: "thunderstrux-app:release", id: `sha256:${"1".repeat(64)}`, sizeBytes: 390 * MiB },
  ops: { ref: "thunderstrux-ops:release", id: `sha256:${"2".repeat(64)}`, sizeBytes: 940 * MiB },
  requiredMigration: "20261112010000_worker_leases",
  migrationDigest: "f".repeat(64)
});

test("a complete pair within budget is accepted", () => {
  assert.deepEqual(imageBudgets, { web: 600 * MiB, ops: 1024 * MiB });
  assert.ok(validateReleaseManifest(manifest()));
});

test("a pair over budget, sharing one image, or missing its revision or migration chain is refused", () => {
  const cases = [
    [(m) => { m.web.sizeBytes = 601 * MiB; }, /web image is 601\.0 MiB, over its 600 MiB budget/],
    [(m) => { m.ops.sizeBytes = 1025 * MiB; }, /ops image is 1025\.0 MiB/],
    [(m) => { m.ops.id = m.web.id; }, /different images/],
    [(m) => { m.web.id = "thunderstrux-app:latest"; }, /immutable sha256 id/],
    [(m) => { m.revision = "main"; }, /full git revision/],
    [(m) => { delete m.migrationDigest; }, /migration digest/],
    [(m) => { m.requiredMigration = ""; }, /required migration/],
    [(m) => { m.version = 2; }, /version must be 1/]
  ];
  for (const [change, error] of cases) {
    const candidate = manifest();
    change(candidate);
    assert.throws(() => validateReleaseManifest(candidate), error);
  }
});
