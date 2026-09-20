import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  copyFile,
  chmod,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import {
  assertHttpLoopbackUrl,
  assertOperationsProject,
  assertRestoreDatabase,
  assertRollbackCompatibility,
  databaseUrlForRestore,
  migrationDigest
} from "./operations-guards.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseCompose = resolve(root, "docker-compose.yml");
const operationsCompose = resolve(root, "docker-compose.operations.yml");
const commandName = process.argv[2];
const args = process.argv.slice(3);

function option(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function has(name) {
  return args.includes(name);
}

function required(name) {
  const value = option(name);
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

function run(executable, commandArgs, { capture = false, env = process.env, input } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, commandArgs, {
      cwd: root,
      env,
      shell: false,
      stdio: [input ? "pipe" : "ignore", capture ? "pipe" : "inherit", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    if (capture) child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    if (input) {
      const source = createReadStream(input);
      source.on("error", reject);
      source.pipe(child.stdin);
    }
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise(stdout.trim());
      else reject(new Error(`${executable} exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

function runToFile(executable, commandArgs, path, env) {
  return new Promise((resolvePromise, reject) => {
    const output = createWriteStream(path, { flags: "wx", mode: 0o600 });
    const child = spawn(executable, commandArgs, {
      cwd: root,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    let childCode = null;
    let outputClosed = false;
    let settled = false;
    const finish = () => {
      if (settled || childCode === null || !outputClosed) return;
      settled = true;
      if (childCode === 0) resolvePromise();
      else reject(new Error(`${executable} exited ${childCode}: ${stderr.slice(-2000)}`));
    };
    child.stdout.pipe(output);
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    output.on("error", reject);
    output.on("close", () => {
      outputClosed = true;
      finish();
    });
    child.on("exit", (code) => {
      childCode = code;
      finish();
    });
  });
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function currentMigrationDigest() {
  const migrationsRoot = resolve(root, "prisma", "migrations");
  const directories = await readdir(migrationsRoot, { withFileTypes: true });
  const entries = [];
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const path = join(migrationsRoot, directory.name, "migration.sql");
    entries.push({ name: directory.name, contents: await readFile(path, "utf8") });
  }
  return migrationDigest(entries);
}

function context() {
  const project = assertOperationsProject(required("--project"));
  const envFile = resolve(root, required("--env-file"));
  const rehearsal = has("--rehearsal");
  const composeArgs = ["compose", "--env-file", envFile, "-f", baseCompose];
  if (rehearsal) composeArgs.push("-f", operationsCompose);
  composeArgs.push("-p", project);
  const stateDir = resolve(root, "tmp", "operations", project);
  return { project, envFile, rehearsal, composeArgs, stateDir };
}

function compose(ctx, commandArgs, options = {}) {
  return run("docker", [...ctx.composeArgs, ...commandArgs], options);
}

async function restrictStateDirectory(path) {
  if (process.platform === "win32") {
    const owner = `${process.env.USERDOMAIN}\\${userInfo().username}`;
    await run("icacls", [path, "/inheritance:r", "/grant:r", `${owner}:(OI)(CI)F`, "SYSTEM:(OI)(CI)F"]);
  }
}

function contextWithEnvFile(ctx, envFile) {
  const index = ctx.composeArgs.indexOf("--env-file");
  const composeArgs = [...ctx.composeArgs];
  composeArgs[index + 1] = envFile;
  return { ...ctx, envFile, composeArgs };
}

async function backup(ctx) {
  await mkdir(ctx.stateDir, { recursive: true, mode: 0o700 });
  await restrictStateDirectory(ctx.stateDir);
  await compose(ctx, ["up", "-d", "--wait", "db"]);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${ctx.project}-${timestamp}`;
  const temporary = join(ctx.stateDir, `${base}.dump.partial`);
  const archive = join(ctx.stateDir, `${base}.dump`);
  const metadata = join(ctx.stateDir, `${base}.json`);
  try {
    const sourceDatabase = await compose(ctx, ["exec", "-T", "db", "sh", "-c", 'printf "%s" "$POSTGRES_DB"'], { capture: true });
    await runToFile(
      "docker",
      [...ctx.composeArgs, "exec", "-T", "db", "sh", "-c", 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'],
      temporary,
      process.env
    );
    const size = (await stat(temporary)).size;
    if (size < 100) throw new Error("Backup archive is unexpectedly small");
    const digest = await sha256(temporary);
    await rename(temporary, archive);
    const currentRelease = await readFile(join(ctx.stateDir, "current-release.json"), "utf8")
      .then((contents) => JSON.parse(contents))
      .catch(() => null);
    const record = {
      version: 1,
      project: ctx.project,
      sourceDatabase,
      createdAt: new Date().toISOString(),
      archive: archive.split(/[\\/]/).pop(),
      bytes: size,
      sha256: digest,
      migrationDigest: await currentMigrationDigest(),
      release: currentRelease
        ? { release: currentRelease.release, candidateImageId: currentRelease.candidateImageId }
        : null
    };
    const metadataTemporary = `${metadata}.partial`;
    await writeFile(metadataTemporary, JSON.stringify(record, null, 2), { mode: 0o600 });
    await rename(metadataTemporary, metadata);
    await pruneBackups(ctx.stateDir, ctx.project);
    return { archive, metadata, record };
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function pruneBackups(directory, project) {
  const files = (await readdir(directory))
    .filter((name) => name.startsWith(`${project}-`) && name.endsWith(".dump"))
    .sort()
    .reverse();
  for (const name of files.slice(7)) {
    const archive = join(directory, name);
    const metadata = archive.replace(/\.dump$/, ".json");
    await unlink(archive);
    await unlink(metadata).catch(() => {});
  }
}

async function smoke(url) {
  const origin = assertHttpLoopbackUrl(url);
  for (const path of ["/api/health", "/api/health/ready", "/"]) {
    const response = await fetchWithTimeout(`${origin}${path}`, 3_000);
    if (response.status < 200 || response.status >= 400) {
      throw new Error(`Read-only smoke check failed for ${path}: HTTP ${response.status}`);
    }
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("HTTP request timed out")), timeoutMs);
  try {
    return await fetch(url, { redirect: "manual", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function waitReady(url, attempts = 60) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await smoke(url);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
    }
  }
  throw lastError ?? new Error("Readiness timed out");
}

async function acquireLock(ctx) {
  await mkdir(ctx.stateDir, { recursive: true, mode: 0o700 });
  await restrictStateDirectory(ctx.stateDir);
  const lockPath = join(ctx.stateDir, "deploy.lock");
  const handle = await open(lockPath, "wx", 0o600).catch((error) => {
    if (error.code === "EEXIST") throw new Error(`Deployment lock already exists: ${lockPath}`);
    throw error;
  });
  await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
  await handle.close();
  return async () => unlink(lockPath).catch(() => {});
}

async function deploy(ctx) {
  const url = assertHttpLoopbackUrl(required("--url"));
  const release = option("--release", `local-${Date.now()}`);
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(release)) throw new Error("Invalid release identifier");
  const image = `thunderstrux-app:${release}`;
  const deploymentEnv = { ...process.env, APP_IMAGE: image };
  const readinessAttempts = Number(option("--readiness-attempts", "60"));
  if (!Number.isInteger(readinessAttempts) || readinessAttempts < 1 || readinessAttempts > 120) {
    throw new Error("--readiness-attempts must be an integer from 1 to 120");
  }
  const releaseLock = await acquireLock(ctx);
  let migrationStarted = false;
  let previousImageId = null;
  let writersRestored = false;
  const activeEnvFile = join(ctx.stateDir, "active.env");
  const releaseManifestFile = join(ctx.stateDir, "current-release.json");
  const hasActiveEnv = await stat(activeEnvFile).then(() => true).catch(() => false);
  const previousManifest = await readFile(releaseManifestFile, "utf8")
    .then((contents) => JSON.parse(contents))
    .catch(() => null);
  try {
    if (has("--skip-build")) {
      console.error("P2.17 deploy: using prebuilt candidate");
    } else {
      console.error("P2.17 deploy: building candidate");
      await compose(ctx, ["build", "app"], { env: deploymentEnv });
    }
    const candidateImageId = await run("docker", ["image", "inspect", "--format", "{{.Id}}", image], { capture: true });
    const previousContainer = await run("docker", [
      "ps",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${ctx.project}`,
      "--filter",
      "label=com.docker.compose.service=app"
    ], { capture: true });
    previousImageId = previousContainer
      ? await run("docker", ["inspect", "--format", "{{.Image}}", previousContainer], { capture: true })
      : null;
    console.error(`P2.17 deploy: previous release ${previousImageId ? "found" : "not found"}`);
    if (previousContainer) await compose(ctx, ["stop", "-t", "20", "app"]);
    console.error("P2.17 deploy: creating pre-migration backup");
    const backupResult = await backup(ctx);
    migrationStarted = true;
    console.error("P2.17 deploy: running migrations");
    await compose(ctx, ["run", "--rm", "migration"], { env: deploymentEnv });
    console.error("P2.17 deploy: starting candidate");
    await compose(ctx, ["up", "-d", "--no-build", "--force-recreate", "app"], { env: deploymentEnv });
    try {
      console.error("P2.17 deploy: waiting for readiness");
      await waitReady(url, readinessAttempts);
    } catch (error) {
      await compose(ctx, ["stop", "-t", "10", "app"]).catch(() => {});
      const compatibilityFile = option("--compatibility-file");
      if (!previousImageId) throw new Error("Candidate failed and no previous running app container was found");
      if (!compatibilityFile) throw new Error("Candidate failed and no rollback compatibility declaration was provided");
      const expected = {
        candidateImageId,
        previousImageId,
        migrationDigest: await currentMigrationDigest()
      };
      await assertRollbackCompatibility(resolve(root, compatibilityFile), expected);
      if (!hasActiveEnv) throw new Error("No protected previous environment snapshot is available");
      if (!previousManifest?.imageRef) throw new Error("Previous release has no immutable image reference");
      const rollbackContext = contextWithEnvFile(ctx, activeEnvFile);
      await compose(rollbackContext, ["up", "-d", "--no-build", "--force-recreate", "app"], {
        env: { ...process.env, APP_IMAGE: previousManifest.imageRef }
      });
      try {
        await waitReady(url, Math.max(readinessAttempts, 30));
      } catch (rollbackError) {
        const logs = await compose(rollbackContext, ["logs", "--no-color", "--tail", "40", "app"], {
          capture: true,
          env: { ...process.env, APP_IMAGE: previousManifest.imageRef }
        }).catch(() => "logs unavailable");
        throw new Error(`Previous release failed readiness: ${rollbackError.message}; ${logs.slice(-1500)}`);
      }
      writersRestored = true;
      throw new Error(`Candidate failed readiness and previous release was restored: ${error.message}`);
    }
    const manifest = {
      version: 1,
      project: ctx.project,
      release,
      deployedAt: new Date().toISOString(),
      candidateImageId,
      imageRef: image,
      previousImageId,
      migrationDigest: await currentMigrationDigest(),
      backup: backupResult.record
    };
    const pendingEnv = `${activeEnvFile}.partial`;
    await copyFile(ctx.envFile, pendingEnv);
    if (process.platform !== "win32") await chmod(pendingEnv, 0o600);
    await stat(pendingEnv);
    await rename(pendingEnv, activeEnvFile);
    await writeFile(releaseManifestFile, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    console.error("P2.17 deploy: release recorded");
    console.log(JSON.stringify({ status: "deployed", release, candidateImageId }));
  } catch (error) {
    if (migrationStarted && !writersRestored) {
      console.error("Migration began; writers remain stopped until the database state is inspected.");
    } else if (previousImageId) {
      const recoveryContext = hasActiveEnv ? contextWithEnvFile(ctx, activeEnvFile) : ctx;
      await compose(recoveryContext, ["up", "-d", "--no-build", "--force-recreate", "app"], {
        env: { ...process.env, APP_IMAGE: previousManifest?.imageRef ?? previousImageId }
      }).catch(() => {});
    }
    throw error;
  } finally {
    await releaseLock();
  }
}

async function restore(ctx) {
  const archive = resolve(root, required("--archive"));
  const target = assertRestoreDatabase(required("--target-database"));
  const metadataPath = archive.replace(/\.dump$/, ".json");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  if (metadata.project !== ctx.project || metadata.archive !== archive.split(/[\\/]/).pop()) {
    throw new Error("Backup ownership metadata does not match this project/archive");
  }
  if (await sha256(archive) !== metadata.sha256) throw new Error("Backup checksum does not match metadata");
  await compose(ctx, ["up", "-d", "--wait", "db"]);
  const exists = await compose(ctx, ["exec", "-T", "db", "sh", "-c", `psql -U "$POSTGRES_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${target}'"`], { capture: true });
  if (exists === "1") throw new Error("Restore target already exists; refusing to overwrite it");
  await compose(ctx, ["exec", "-T", "db", "sh", "-c", `createdb -U "$POSTGRES_USER" "${target}"`]);
  try {
    await run(
      "docker",
      [...ctx.composeArgs, "exec", "-T", "db", "sh", "-c", `pg_restore -U "$POSTGRES_USER" -d "${target}" --no-owner --no-privileges --exit-on-error`],
      { input: archive }
    );
    const sourceDatabaseUrl = ctx.rehearsal
      ? "postgresql://p217:p217-disposable-only@db:5432/p217_app_test?schema=public"
      : parseEnv(await readFile(ctx.envFile, "utf8")).DATABASE_URL;
    if (!sourceDatabaseUrl) throw new Error("DATABASE_URL is missing from the explicit environment file");
    const restoredUrl = databaseUrlForRestore(sourceDatabaseUrl, target);
    const release = JSON.parse(await readFile(join(ctx.stateDir, "current-release.json"), "utf8"));
    await compose(ctx, ["run", "--rm", "-e", `DATABASE_URL=${restoredUrl}`, "migration", "node", "scripts/verify-restored-database.mjs"], {
      env: { ...process.env, APP_IMAGE: release.candidateImageId }
    });
    console.log(JSON.stringify({ status: "restored-and-verified", target }));
  } catch (error) {
    throw new Error(`Restore target ${target} is quarantined and was not promoted: ${error.message}`);
  }
}

try {
  if (commandName === "smoke") await smoke(required("--url"));
  else {
    const ctx = context();
    if (commandName === "backup") console.log(JSON.stringify((await backup(ctx)).record));
    else if (commandName === "restore") await restore(ctx);
    else if (commandName === "deploy") await deploy(ctx);
    else throw new Error("Use deploy, backup, restore, or smoke");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
