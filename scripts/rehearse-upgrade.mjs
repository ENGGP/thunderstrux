// T41: upgrade a populated database. Each archive (a pg_dump custom-format
// backup, such as the dev dumps in tmp/) is restored into a throwaway Postgres
// container as a `_test` database, migrated to this checkout's schema, and
// audited with the integrity checks. Nothing touches the dev or production
// volumes, and every container is removed afterwards.
//
// Usage: node scripts/rehearse-upgrade.mjs <archive.dump> [...]
// Needs the e2e test image (thunderstrux-e2e-tests:local, built by run-e2e).
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const postgresImage = "postgres:16@sha256:1a6ab3f5345eb6dbe04a1349529caabdb0ab09293a09590fad07b2246bfa4b54";
const toolsImage = process.env.REHEARSAL_TOOLS_IMAGE ?? "thunderstrux-e2e-tests:local";
const database = "upgrade_rehearsal_test";
const archives = process.argv.slice(2).filter((arg) => arg !== "--");
if (!archives.length) throw new Error("Give at least one pg_dump archive");
if (!database.includes("_test")) throw new Error("Rehearsals use a _test database only");

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.status !== 0 && !options.allowFailure) throw new Error(`${command} ${args.slice(0, 3).join(" ")} failed: ${(result.stderr || result.stdout).slice(-2000)}`);
  return result;
};
const docker = (args, options) => run("docker", args, { ...options, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });

const results = [];
for (const archive of archives) {
  const path = resolve(archive);
  if (!existsSync(path)) throw new Error(`No archive at ${path}`);
  // Custom-format header "PGDMP" then major, minor; Postgres 16's pg_restore reads up to 1.15.
  const [major, minor] = readFileSync(path).subarray(5, 7);
  if (major > 1 || minor > 15) {
    results.push({ archive, skipped: `written by a newer pg_dump (archive ${major}.${minor}); restore it with pg_restore 17 or later` });
    continue;
  }
  const container = `upgrade-rehearsal-${randomBytes(6).toString("hex")}`;
  try {
    docker(["run", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=rehearsal-disposable-only", "-e", `POSTGRES_DB=${database}`, postgresImage]);
    for (let attempt = 0; docker(["exec", container, "pg_isready", "-U", "postgres", "-d", database], { allowFailure: true }).status !== 0; attempt += 1) {
      if (attempt > 60) throw new Error("Rehearsal database did not start");
      spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 500)"]);
    }
    docker(["cp", path, `${container}:/tmp/archive.dump`]);
    // Roles from the source don't exist here; ownership and grants are dropped.
    docker(["exec", container, "pg_restore", "-U", "postgres", "-d", database, "--no-owner", "--no-privileges", "--exit-on-error", "/tmp/archive.dump"]);
    const count = (sql) => Number(docker(["exec", container, "psql", "-U", "postgres", "-d", database, "-tAc", sql]).stdout.trim());
    const before = count(`SELECT count(*) FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL`);
    const rows = () => count(`SELECT (SELECT count(*) FROM "User") + (SELECT count(*) FROM "Order") + (SELECT count(*) FROM "Event")`);
    const rowsBefore = rows();
    const url = `postgresql://postgres:rehearsal-disposable-only@localhost:5432/${database}?schema=public`;
    // The checkout's migrations and audit run from the tools image against the restored copy.
    const tar = spawnSync("tar", ["--exclude=./node_modules", "--exclude=./.git", "--exclude=./.next", "--exclude=./tmp", "--exclude=./test-results", "--exclude=./.claude", "-cf", "-", "."], { maxBuffer: 512 * 1024 * 1024 });
    const tools = docker(["run", "--rm", "-i", "--network", `container:${container}`, "-w", "/src", "-e", `DATABASE_URL=${url}`, "-e", "NODE_ENV=test", toolsImage, "sh", "-c",
      "tar xf - && ln -s /app/node_modules node_modules && npx prisma migrate deploy >/tmp/migrate.log 2>&1 || { tail -40 /tmp/migrate.log; exit 1; }; npx prisma generate >/dev/null 2>&1 && node scripts/audit-db-integrity.mjs"
    ], { input: tar.stdout, allowFailure: true });
    // The audit exits 1 when it finds something; without its header the migration itself failed.
    if (!tools.stdout.includes("Thunderstrux database integrity audit")) throw new Error(`Migration failed for ${archive}:\n${tools.stdout.slice(-3000)}${tools.stderr.slice(-2000)}`);
    const after = count(`SELECT count(*) FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL`);
    const summary = tools.stdout.match(/checks=(\d+) totalViolations=(\d+) unexplained=(\d+)/);
    const failing = [...tools.stdout.matchAll(/check=(\S+)\nclass=\S+\nviolations=([1-9]\d*)/g)].map(([, name, n]) => `${name}=${n}`);
    results.push({ archive, migrationsBefore: before, migrationsAfter: after, rowsBefore, rowsAfter: rows(), checks: Number(summary?.[1]), violations: Number(summary?.[2]), unexplained: Number(summary?.[3]), failing });
  } finally {
    docker(["rm", "-fv", container], { allowFailure: true });
  }
}
console.log(JSON.stringify(results, null, 2));
if (results.some((result) => result.unexplained > 0 || result.rowsAfter !== result.rowsBefore)) process.exitCode = 1;
