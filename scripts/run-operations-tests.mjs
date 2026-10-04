import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrationDigest } from "./operations-guards.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = `p217-ci-${randomBytes(5).toString("hex")}`;
const stateDir = resolve(root, "tmp", "operations", project);
const runtimeFile = join(stateDir, "runtime.env");
const badRuntimeFile = join(stateDir, "candidate-bad.env");
const compatibilityFile = join(stateDir, "rollback-compatibility.json");
const composeFiles = [
  "compose",
  "--env-file",
  runtimeFile,
  "-f",
  resolve(root, "docker-compose.yml"),
  "-f",
  resolve(root, "docker-compose.hardened.yml"),
  "-f",
  resolve(root, "docker-compose.operations.yml"),
  "-p",
  project
];
let activeChild;
let passed = false;
let signalContainer;

function command(executable, args, { capture = false, env = process.env, expectFailure = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      env,
      shell: false,
      stdio: ["ignore", capture ? "pipe" : "inherit", capture ? "pipe" : "inherit"]
    });
    activeChild = child;
    let output = "";
    if (capture) {
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.on("data", (chunk) => { output += chunk; });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      activeChild = undefined;
      if ((!expectFailure && code === 0) || (expectFailure && code !== 0)) resolvePromise(output);
      else reject(new Error(`${executable} exited ${code}${capture ? `: ${output.slice(-2500)}` : ""}`));
    });
  });
}

function docker(args, options) {
  return command("docker", args, options);
}

function compose(args, options = {}) {
  return docker([...composeFiles, ...args], options);
}

function operation(name, extra = [], options = {}) {
  return command(
    process.execPath,
    [
      "scripts/operations.mjs",
      name,
      "--project",
      project,
      "--env-file",
      runtimeFile,
      "--rehearsal",
      ...extra
    ],
    options
  );
}

async function availablePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePromise(address.port));
    });
  });
}

async function waitReady(origin) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetchWithTimeout(`${origin}/api/health/ready`, 2_500);
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  throw new Error("Rehearsal app did not recover readiness");
}

async function expectStatus(origin, path, expected) {
  const response = await fetchWithTimeout(`${origin}${path}`, 4_000);
  if (response.status !== expected) {
    throw new Error(`${path} returned ${response.status}; expected ${expected}`);
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("HTTP request timed out")), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function migrationChecksum() {
  const directories = await (await import("node:fs/promises")).readdir(resolve(root, "prisma", "migrations"), { withFileTypes: true });
  const entries = [];
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    entries.push({
      name: directory.name,
      contents: await readFile(resolve(root, "prisma", "migrations", directory.name, "migration.sql"), "utf8")
    });
  }
  return migrationDigest(entries);
}

async function assertContainerHardening(container, label) {
  const user = await docker(["inspect", "--format", "{{.Config.User}}", container], { capture: true });
  if (!user.trim() || user.trim() === "0" || user.trim() === "root" || user.trim().startsWith("0:")) {
    throw new Error(`${label} is not non-root: ${user.trim() || "unset"}`);
  }
  const inspect = JSON.parse(await docker([
    "inspect", "--format", "{{json .}}", container
  ], { capture: true }));
  const hardening = inspect.HostConfig;
  if (!hardening.ReadonlyRootfs) throw new Error(`${label} root filesystem is writable`);
  if (!hardening.CapDrop?.includes("ALL")) throw new Error(`${label} does not drop all capabilities`);
  if (!hardening.SecurityOpt?.includes("no-new-privileges:true")) {
    throw new Error(`${label} does not set no-new-privileges`);
  }
  if (!(hardening.PidsLimit > 0) || !(hardening.Memory > 0) || !(hardening.NanoCpus > 0)) {
    throw new Error(`${label} resource limits are incomplete`);
  }
  if (inspect.Config.StopTimeout !== 30) throw new Error(`${label} does not use a 30-second stop period`);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => activeChild?.kill("SIGTERM"));
}

const port = await availablePort();
const origin = `http://127.0.0.1:${port}`;
const runtime = [
  "DATABASE_URL=postgresql://p217:p217-disposable-only@db:5432/p217_app_test?schema=public",
  `AUTH_SECRET=${randomBytes(32).toString("hex")}`,
  "MFA_ENFORCEMENT_MODE=off",
  `NOTIFICATION_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
  "LEGACY_ORGANISATION_ACCESS_MODE=deny",
  `AUTH_URL=${origin}`,
  `NEXTAUTH_URL=${origin}`,
  `NEXT_PUBLIC_APP_URL=${origin}`,
  `TRUSTED_APP_ORIGINS=${origin}`,
  `APP_PORT=${port}`,
  "PORT=3000",
  "RATE_LIMIT_ENABLED=true",
  "RATE_LIMIT_REDIS_URL=redis://redis:6379",
  "RATE_LIMIT_KEY_PREFIX=p217",
  "STRIPE_SECRET_KEY=",
  "STRIPE_WEBHOOK_SECRET=",
  "STRIPE_CONNECT_WEBHOOK_SECRET=",
  "RESEND_API_KEY=",
  "EMAIL_FROM="
].join("\n") + "\n";

await mkdir(stateDir, { recursive: true, mode: 0o700 });
await writeFile(runtimeFile, runtime, { mode: 0o600 });

try {
  await operation("deploy", ["--url", origin, "--release", `${project}-one`]);
  const release = JSON.parse(await readFile(join(stateDir, "current-release.json"), "utf8"));
  const appContainer = await compose(["ps", "-q", "app"], { capture: true });
  await assertContainerHardening(appContainer.trim(), "Production app");
  await compose(["exec", "-T", "app", "sh", "-c", "touch /tmp/thunderstrux-hardening-check && rm /tmp/thunderstrux-hardening-check"]);

  await compose(["--profile", "workers", "create", "migration", "email-worker", "notification-worker", "stale-order-worker", "compensation-worker"], {
    env: { ...process.env, APP_IMAGE: release.candidateImageId }
  });
  for (const service of ["migration", "email-worker", "notification-worker", "stale-order-worker", "compensation-worker"]) {
    const container = await compose(["--profile", "workers", "ps", "-a", "-q", service], { capture: true });
    await assertContainerHardening(container.trim(), service);
  }

  const secretFile = join(stateDir, "entrypoint-secret.txt");
  // The Linux CI container runs as uid 1000, which differs from the host runner uid.
  // Keep the run-owned parent directory private while making the read-only bind fixture readable.
  await writeFile(secretFile, "file-backed-test-secret\n", { mode: 0o644 });
  await docker([
    "run", "--rm",
    "--mount", `type=bind,source=${secretFile},target=/run/secrets/auth_secret,readonly`,
    "-e", "AUTH_SECRET_FILE=/run/secrets/auth_secret",
    release.candidateImageId,
    "node", "-e", "if(process.env.AUTH_SECRET!=='file-backed-test-secret')process.exit(1)"
  ]);
  const conflictOutput = await command("docker", [
    "run", "--rm",
    "--mount", `type=bind,source=${secretFile},target=/run/secrets/auth_secret,readonly`,
    "-e", "AUTH_SECRET=direct-test-secret",
    "-e", "AUTH_SECRET_FILE=/run/secrets/auth_secret",
    release.candidateImageId,
    "node", "-e", "process.exit(0)"
  ], { capture: true, expectFailure: true });
  if (conflictOutput.includes("direct-test-secret") || conflictOutput.includes("file-backed-test-secret")) {
    throw new Error("Secret-loader conflict diagnostic exposed a secret value");
  }
  const emptySecretFile = join(stateDir, "entrypoint-empty-secret.txt");
  await writeFile(emptySecretFile, "", { mode: 0o644 });
  const rejectedSecretCases = [
    ["AUTH_SECRET_FILE=relative-secret", []],
    ["AUTH_SECRET_FILE=/run/secrets/missing", []],
    ["AUTH_SECRET_FILE=/run/secrets/auth_secret", ["--mount", `type=bind,source=${emptySecretFile},target=/run/secrets/auth_secret,readonly`]]
  ];
  for (const [variable, mounts] of rejectedSecretCases) {
    const output = await command("docker", [
      "run", "--rm", ...mounts, "-e", variable, release.candidateImageId,
      "node", "-e", "process.exit(0)"
    ], { capture: true, expectFailure: true });
    if (output.includes("direct-test-secret") || output.includes("file-backed-test-secret")) {
      throw new Error("Secret-loader rejection diagnostic exposed a secret value");
    }
  }

  signalContainer = `${project}-signal-check`;
  await docker([
    "run", "-d", "--name", signalContainer, release.candidateImageId,
    "node", "-e", "process.on('SIGTERM',()=>{console.log('sigterm-forwarded');process.exit(0)});setInterval(()=>{},1000)"
  ]);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  await docker(["stop", "-t", "5", signalContainer]);
  const signalLogs = await docker(["logs", signalContainer], { capture: true });
  if (!signalLogs.includes("sigterm-forwarded")) throw new Error("Entrypoint did not forward SIGTERM to Node");
  await docker(["rm", signalContainer]);

  await compose(["run", "--rm", "email-worker"], { env: { ...process.env, APP_IMAGE: release.candidateImageId } });
  await compose(["run", "--rm", "notification-worker"], { env: { ...process.env, APP_IMAGE: release.candidateImageId } });
  await compose(["run", "--rm", "stale-order-worker"], { env: { ...process.env, APP_IMAGE: release.candidateImageId } });
  await compose(["run", "--rm", "compensation-worker"], { env: { ...process.env, APP_IMAGE: release.candidateImageId } });

  await compose(["run", "--rm", "migration", "node", "prisma/seed.mjs"], {
    env: { ...process.env, APP_IMAGE: release.candidateImageId }
  });
  await compose(["run", "--rm", "migration", "node", "scripts/seed-operations-verification.mjs"], {
    env: { ...process.env, APP_IMAGE: release.candidateImageId }
  });
  const backupOutput = await operation("backup", [], { capture: true });
  const backupRecord = JSON.parse(backupOutput.split(/\r?\n/).filter(Boolean).at(-1));
  const archive = join(stateDir, backupRecord.archive);
  const archiveBytes = await readFile(archive);
  const corruptArchive = join(stateDir, "corrupt.dump");
  const corruptBytes = archiveBytes.subarray(0, Math.min(256, archiveBytes.length));
  const corruptHash = (await import("node:crypto")).createHash("sha256").update(corruptBytes).digest("hex");
  await writeFile(corruptArchive, corruptBytes, { mode: 0o600 });
  await writeFile(corruptArchive.replace(/\.dump$/, ".json"), JSON.stringify({
    ...backupRecord,
    archive: "corrupt.dump",
    bytes: corruptBytes.length,
    sha256: corruptHash
  }), { mode: 0o600 });
  const corruptRestore = await operation("restore", [
    "--archive", corruptArchive,
    "--target-database", `${project.replace(/-/g, "_")}_broken_restore_test`
  ], { capture: true, expectFailure: true });
  if (!corruptRestore.includes("quarantined")) throw new Error("Corrupt restore was not quarantined");
  await operation("restore", ["--archive", archive, "--target-database", `${project.replace(/-/g, "_")}_restore_test`]);

  await compose(["stop", "db"]);
  await expectStatus(origin, "/api/health", 200);
  await expectStatus(origin, "/api/health/ready", 503);
  await compose(["start", "db"]);
  await waitReady(origin);

  await compose(["stop", "redis"]);
  await expectStatus(origin, "/api/health", 200);
  await expectStatus(origin, "/api/health/ready", 503);
  await compose(["start", "redis"]);
  await waitReady(origin);

  const badRuntime = runtime.replace("RATE_LIMIT_REDIS_URL=redis://redis:6379", "RATE_LIMIT_REDIS_URL=redis://unreachable:6379");
  await writeFile(badRuntimeFile, badRuntime, { mode: 0o600 });
  const candidateTag = `thunderstrux-app:${project}-bad`;
  const badComposeFiles = [...composeFiles];
  badComposeFiles[badComposeFiles.indexOf(runtimeFile)] = badRuntimeFile;
  await docker([...badComposeFiles, "build", "app"], { env: { ...process.env, APP_IMAGE: candidateTag } });
  const candidateImageId = await docker(["image", "inspect", "--format", "{{.Id}}", candidateTag], { capture: true });
  const previousImageId = await docker(["inspect", "--format", "{{.Image}}", appContainer.trim()], { capture: true });
  await writeFile(compatibilityFile, JSON.stringify({
    candidateImageId: candidateImageId.trim(),
    previousImageId: previousImageId.trim(),
    migrationDigest: await migrationChecksum(),
    reviewed: true
  }, null, 2), { mode: 0o600 });
  const rollbackOutput = await command(process.execPath, [
    "scripts/operations.mjs", "deploy", "--project", project,
    "--env-file", badRuntimeFile, "--rehearsal", "--url", origin,
    "--release", `${project}-bad`, "--skip-build", "--readiness-attempts", "3",
    "--compatibility-file", compatibilityFile
  ], { capture: true, expectFailure: true });
  if (!rollbackOutput.includes("previous release was restored")) {
    throw new Error(`Rollback evidence missing: ${rollbackOutput.slice(-1000)}`);
  }
  await waitReady(origin);

  await compose(["exec", "-T", "db", "sh", "-c", `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "INSERT INTO \"_prisma_migrations\" (id, checksum, migration_name, logs, started_at, applied_steps_count) VALUES ('p217_failed', 'invalid', 'p217_intentional_failure', 'rehearsal', now(), 0)"`]);
  const migrationFailure = await operation("deploy", [
    "--url", origin,
    "--release", `${project}-migration-fail`,
    "--readiness-attempts", "3"
  ], { capture: true, expectFailure: true });
  if (!migrationFailure.includes("writers remain stopped")) {
    throw new Error(`Migration blocking evidence missing: ${migrationFailure.slice(-1000)}`);
  }
  const runningApp = await compose(["ps", "-q", "--status", "running", "app"], { capture: true });
  if (runningApp.trim()) throw new Error("App remained running after migration failure");
  passed = true;
  console.log(JSON.stringify({ status: "passed", project, restore: backupRecord.archive }));
} finally {
  // Compose ps/down without the workers profile omits its created services.
  const ownershipFilter = `label=com.docker.compose.project=${project}`;
  const ownedContainers = (await docker(["ps", "-aq", "--filter", ownershipFilter], { capture: true }))
    .split(/\s+/).filter(Boolean);
  for (const container of ownedContainers) {
    const owner = await docker(["inspect", "--format", "{{index .Config.Labels \"com.docker.compose.project\"}}", container], { capture: true });
    if (owner.trim() !== project) throw new Error("Operations cleanup ownership mismatch");
  }
  if (signalContainer) await docker(["rm", "-f", signalContainer], { capture: true }).catch(() => {});
  await compose(["--profile", "workers", "down", "--volumes", "--remove-orphans", "--timeout", "10"], { capture: true });
  // This is also the cleanup regression: a passing rehearsal must leave no
  // project-owned container (including stopped workers), network or volume.
  for (const args of [["ps", "-aq"], ["network", "ls", "-q"], ["volume", "ls", "-q"]]) {
    const remaining = await docker([...args, "--filter", ownershipFilter], { capture: true });
    if (remaining.trim()) throw new Error(`Operations cleanup incomplete for ${project}: ${args[0]}`);
  }
  if (passed) {
    for (const suffix of ["one", "bad", "migration-fail"]) {
      await docker(["image", "rm", `thunderstrux-app:${project}-${suffix}`], { capture: true }).catch(() => {});
    }
    await rm(stateDir, { recursive: true, force: true });
  } else {
    console.error(`P2.17 diagnostics retained in ${stateDir}`);
  }
}
