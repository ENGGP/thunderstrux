import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertHttpLoopbackUrl,
  assertOperationsProject,
  assertRestoreDatabase,
  assertRollbackCompatibility,
  databaseUrlForRestore,
  migrationDigest
} from "../../scripts/operations-guards.mjs";

test("operations identifiers are narrowly scoped", () => {
  assert.equal(assertOperationsProject("p217-local-rehearsal"), "p217-local-rehearsal");
  assert.throws(() => assertOperationsProject("thunderstrux"));
  assert.equal(assertRestoreDatabase("p217_restore_test"), "p217_restore_test");
  assert.throws(() => assertRestoreDatabase("thunderstrux"));
});

test("rehearsal URLs are loopback-only", () => {
  assert.equal(assertHttpLoopbackUrl("http://127.0.0.1:3200"), "http://127.0.0.1:3200");
  assert.throws(() => assertHttpLoopbackUrl("https://example.com"));
});

test("restore URL preserves credentials and replaces only the database", () => {
  const result = databaseUrlForRestore(
    "postgresql://app:secret@db:5432/source?schema=public",
    "verified_restore_test"
  );
  assert.equal(result, "postgresql://app:secret@db:5432/verified_restore_test?schema=public");
  assert.throws(() => databaseUrlForRestore(
    "postgresql://app:secret@db:5432/verified_restore_test?schema=public",
    "verified_restore_test"
  ));
});

test("migration digest is stable and content-sensitive", () => {
  const first = migrationDigest([{ name: "b", contents: "2" }, { name: "a", contents: "1" }]);
  assert.equal(first, migrationDigest([{ name: "a", contents: "1" }, { name: "b", contents: "2" }]));
  assert.notEqual(first, migrationDigest([{ name: "a", contents: "changed" }]));
});

test("rollback declaration must be reviewed and match the actual release", async () => {
  const directory = await mkdtemp(join(tmpdir(), "p217-compat-"));
  const path = join(directory, "compatibility.json");
  const expected = {
    candidateImageId: "sha256:candidate",
    previousImageId: "sha256:previous",
    migrationDigest: "abc"
  };
  await writeFile(path, JSON.stringify({ ...expected, reviewed: true }));
  await assert.doesNotReject(assertRollbackCompatibility(path, expected));
  await writeFile(path, JSON.stringify({ ...expected, reviewed: false }));
  await assert.rejects(assertRollbackCompatibility(path, expected));
});
