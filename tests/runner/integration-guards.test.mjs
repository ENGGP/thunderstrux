import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { validateIntegrationDatabaseUrl } from "../../scripts/integration-test-guards.mjs";

test("integration guard preserves disposable URLs and connection parameters", () => {
  for (const url of [
    "postgresql://test:password@db:5432/thunderstrux_test?schema=public",
    "postgres://test:password@localhost:5432/ci_test",
    "postgresql://test:password@db:5432/my-disposable_test?sslmode=require",
    "postgresql://test:password@db:5432/encoded%5Ftest"
  ]) assert.equal(validateIntegrationDatabaseUrl(url), url);
});

test("integration guard rejects unsafe or malformed targets without exposing credentials", () => {
  for (const value of [
    undefined, "", "not-a-url", "postgresql://",
    "postgresql://test:private-password@db:5432/production",
    "postgresql://test:private-password@db:5432/project_test_archive",
    "https://test:private-password@db/project_test",
    "postgresql://test:private-password@db:5432/folder/project_test",
    "postgresql://test:private-password@db:5432/../project_test",
    "postgresql://test:private-password@db:5432/folder%2Fproject_test",
    "postgresql://test:private-password@db:5432/project%00_test",
    "postgresql://test:private-password@db:5432/project%ZZ_test",
    "postgresql://test:private-password@db:5432/project_test#fragment"
  ]) {
    assert.throws(() => validateIntegrationDatabaseUrl(value), error => {
      assert.match(error.message, /Refusing integration database access/);
      assert.doesNotMatch(error.message, /private-password|postgresql:\/\//);
      return true;
    });
  }
});

test("launcher refuses unsafe targets before any package-manager command", () => {
  for (const url of [
    "postgresql://test:private-password@127.0.0.1:1/project_test_archive",
    "malformed-private-password"
  ]) {
    const result = spawnSync(process.execPath, [resolve("scripts/run-integration-tests.mjs")], {
      env: { ...process.env, INTEGRATION_DATABASE_URL: url, PATH: "", Path: "" },
      encoding: "utf8", timeout: 10000
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Refusing integration database access/);
    assert.doesNotMatch(result.stderr, /private-password|Prisma|ENOENT|EINVAL/);
  }
});
