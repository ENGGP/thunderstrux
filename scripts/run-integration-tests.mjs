import { spawnSync } from "node:child_process";

const defaultTestDatabaseUrl =
  "postgresql://thunderstrux:thunderstrux@db:5432/thunderstrux_test?schema=public";

const databaseUrl =
  process.env.INTEGRATION_DATABASE_URL ||
  process.env.TEST_DATABASE_URL ||
  defaultTestDatabaseUrl;

const parsedDatabaseUrl = new URL(databaseUrl);
const databaseName = parsedDatabaseUrl.pathname.replace(/^\//, "");

if (!databaseName.includes("_test")) {
  console.error(
    `Refusing to run integration tests against non-test database "${databaseName}". The database name must contain "_test".`
  );
  process.exit(1);
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "test",
      THUNDERSTRUX_INTEGRATION_TEST: "1"
    },
    shell: false
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(pnpm, ["prisma", "migrate", "reset", "--force", "--skip-seed"]);
run(pnpm, ["prisma:generate"]);
run(pnpm, [
  "vitest",
  "run",
  "tests/integration",
  "--no-file-parallelism",
  "--maxWorkers=1",
  "--maxConcurrency=1"
]);
