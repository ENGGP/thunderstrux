import { spawnSync } from "node:child_process";

const defaultTestDatabaseUrl =
  "postgresql://thunderstrux:thunderstrux@db:5432/thunderstrux_test?schema=public";

const databaseUrl =
  process.env.INTEGRATION_DATABASE_URL ||
  process.env.TEST_DATABASE_URL ||
  defaultTestDatabaseUrl;

const parsedDatabaseUrl = new URL(databaseUrl);
const databaseName = parsedDatabaseUrl.pathname.replace(/^\//, "");

if (!databaseName.endsWith("_test")) {
  console.error(
    `Refusing to run integration tests against non-test database "${databaseName}".`
  );
  process.exit(1);
}

const adminDatabaseUrl = new URL(databaseUrl);
adminDatabaseUrl.pathname = "/postgres";
adminDatabaseUrl.search = "";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.input ? ["pipe", "inherit", "inherit"] : "inherit",
    input: options.input,
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

const safeDatabaseName = databaseName.replaceAll('"', '""');
const terminateSql = `
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '${databaseName.replaceAll("'", "''")}'
  AND pid <> pg_backend_pid();
`;
const dropSql = `DROP DATABASE IF EXISTS "${safeDatabaseName}";`;
const createSql = `CREATE DATABASE "${safeDatabaseName}";`;

for (const sql of [terminateSql, dropSql, createSql]) {
  run(
    pnpm,
    ["prisma", "db", "execute", "--url", adminDatabaseUrl.toString(), "--stdin"],
    { input: sql }
  );
}
run(pnpm, ["prisma:migrate:deploy"]);
run(pnpm, [
  "vitest",
  "run",
  "tests/integration",
  "--no-file-parallelism",
  "--maxWorkers=1",
  "--maxConcurrency=1"
]);
