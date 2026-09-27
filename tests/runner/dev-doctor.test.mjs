import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidMfaEncryptionKey,
  migrationStatusIsCurrent,
  startupAppliesMigrations
} from "../../scripts/dev-doctor-guards.mjs";
import {
  assertDependencyVolume,
  composeArgs,
  dependencyVolumePlan
} from "../../scripts/recreate-dev-app.mjs";
import { readFileSync } from "node:fs";

test("development startup contract requires migration deployment before the dev server", () => {
  assert.equal(startupAppliesMigrations("sh -c pnpm prisma:migrate:deploy && pnpm dev"), true);
  assert.equal(startupAppliesMigrations("pnpm dev"), false);
  assert.equal(startupAppliesMigrations("pnpm prisma:migrate:deploy"), false);
  assert.equal(startupAppliesMigrations("sh -c pnpm dev && pnpm prisma:migrate:deploy"), false);
});

test("migration status accepts only Prisma's successful current-schema result", () => {
  assert.equal(migrationStatusIsCurrent(0, "Database schema is up to date!"), true);
  assert.equal(migrationStatusIsCurrent(1, "Following migration have not yet been applied"), false);
  assert.equal(migrationStatusIsCurrent(null, ""), false);
});

test("MFA encryption key check accepts only canonical base64 for 32 bytes", () => {
  assert.equal(isValidMfaEncryptionKey(Buffer.alloc(32, 7).toString("base64")), true);
  assert.equal(isValidMfaEncryptionKey(Buffer.alloc(31, 7).toString("base64")), false);
  assert.equal(isValidMfaEncryptionKey("not-base64"), false);
});

test("development recreation refreshes only the dependency cache and regenerates Prisma", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const compose = readFileSync("docker-compose.dev.yml", "utf8");
  const recreation = readFileSync("scripts/recreate-dev-app.mjs", "utf8");

  assert.equal(packageJson.scripts["docker:restart"], "node scripts/recreate-dev-app.mjs");
  assert.match(compose, /prisma:generate && pnpm prisma:migrate:deploy && pnpm dev/);
  assert.match(recreation, /com\.docker\.compose\.volume/);
  assert.match(recreation, /com\.docker\.compose\.project/);
  assert.match(recreation, /"up", "-d", "app"/);
  assert.doesNotMatch(recreation, /"up", "-d", "--no-deps", "app"/);
  assert.doesNotMatch(recreation, /down\s+-v|postgres_data|redis_data/);
});

test("dependency volume planning requires the exact app mount and Compose ownership", () => {
  const config = {
    name: "thunderstrux-test",
    volumes: { node_modules: { name: "thunderstrux-test_node_modules" } },
    services: {
      app: {
        volumes: [
          { type: "volume", source: "node_modules", target: "/app/node_modules" }
        ]
      }
    }
  };
  const plan = dependencyVolumePlan(config);
  assert.deepEqual(plan, {
    projectName: "thunderstrux-test",
    volumeName: "thunderstrux-test_node_modules"
  });
  assert.doesNotThrow(() => assertDependencyVolume({
    Name: plan.volumeName,
    Labels: {
      "com.docker.compose.volume": "node_modules",
      "com.docker.compose.project": plan.projectName
    }
  }, plan));
  assert.throws(() => assertDependencyVolume({
    Name: plan.volumeName,
    Labels: {
      "com.docker.compose.volume": "node_modules",
      "com.docker.compose.project": "another-project"
    }
  }, plan));
  assert.throws(() => dependencyVolumePlan({
    ...config,
    services: { app: { volumes: [] } }
  }));
  assert.deepEqual(composeArgs.slice(-2), ["-f", "docker-compose.dev.yml"]);
});
