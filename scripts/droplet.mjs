// T43b: deploy a release pair to the pilot host (a DigitalOcean Droplet in
// Sydney, managed PostgreSQL and Valkey alongside). Runs from a laptop or CI.
//
//   node scripts/droplet.mjs deploy   --host deploy@<ip> --manifest release.json [--release <name>] --smoke-url https://<domain>
//   node scripts/droplet.mjs rollback --host deploy@<ip> --compatibility-file rollback.json [--to <release>] --smoke-url https://<domain>
//   node scripts/droplet.mjs status   --host deploy@<ip>
//
// --host runs each server step over SSH. --local <dir> runs them on this
// machine instead, with <dir> standing in for /opt/thunderstrux: the local
// rehearsal (scripts/rehearse-droplet.mjs) uses it. Server layout:
//   config.env          non-secret settings (operator-managed; see deploy/droplet/config.env.example)
//   releases/<name>/    the Compose bundle, release.json and images.env of each release
//   current, previous   the names of the running and the last release
// Secrets live in /etc/thunderstrux/secrets (THUNDERSTRUX_SECRETS_DIR in config.env).
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertImmutableImageRef, validateHostedConfig } from "./container-config.mjs";
import { assertRollbackCompatibility } from "./operations-guards.mjs";
import { validateReleaseManifest } from "./release-pair.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const workerServices = ["email-worker", "notification-worker", "stale-order-worker", "compensation-worker", "checkout-recovery-worker", "monitor-worker"];
// The Compose bundle each release carries; deploy/droplet files are flattened beside the rest.
const bundleFiles = ["docker-compose.hosted.yml", "docker-compose.assets.hosted.yml", "docker-compose.schedules.yml"];
const dropletFiles = ["docker-compose.droplet.yml", "Caddyfile"];

// The order every deploy follows. Writers stop before the backup, the schema
// changes only after it, and workers restart only on a healthy web release.
export const deploySteps = ["validate", "upload", "pull", "check-config", "stop-workers", "backup", "migrate", "start-web", "wait-ready", "start-edge", "start-workers", "smoke", "record"];

export const quote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

// The only repositories the release workflow publishes to on main (SEC-022).
export const releaseRepositories = { web: "ghcr.io/enggp/thunderstrux", ops: "ghcr.io/enggp/thunderstrux-ops" };

export function releaseImages(manifest, { local }) {
  validateReleaseManifest(manifest);
  // A real host pulls by registry digest; the local rehearsal runs local image ids.
  if (local) return { APP_IMAGE: manifest.web.id, OPS_IMAGE: manifest.ops.id };
  for (const target of ["web", "ops"]) {
    const ref = assertImmutableImageRef(manifest[target].ref);
    if (ref.split("@")[0].replace(/:[^/]*$/, "") !== releaseRepositories[target]) throw new Error(`The ${target} image must come from ${releaseRepositories[target]}`);
  }
  return { APP_IMAGE: manifest.web.ref, OPS_IMAGE: manifest.ops.ref };
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function log(step, context = {}) {
  console.log(JSON.stringify({ event: "droplet.step", step, at: new Date().toISOString(), ...context }));
}

function spawnText(command, args, { input, env, allowFailure = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env: { ...process.env, MSYS_NO_PATHCONV: "1", ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && !allowFailure) reject(new Error(`${command} exited ${code}: ${(stderr || stdout).slice(-2000)}`));
      else resolvePromise({ code, stdout, stderr });
    });
    if (input) input.pipe(child.stdin); else child.stdin.end();
  });
}

function server(args) {
  const host = option(args, "--host");
  const local = option(args, "--local");
  if (Boolean(host) === Boolean(local)) throw new Error("Give exactly one of --host <user@address> or --local <dir>");
  const base = local ? resolve(local).replace(/\\/g, "/") : "/opt/thunderstrux";
  return {
    local: Boolean(local),
    base,
    // Runs one shell command on the server.
    run: (command, options) => (local ? spawnText("sh", ["-c", command], options) : spawnText("ssh", ["-o", "BatchMode=yes", host, command], options))
  };
}

function composeCommand(target, release, project, extraFiles, composeArgs) {
  const files = [...bundleFiles, ...dropletFiles.filter((file) => file.endsWith(".yml")), ...extraFiles.map((file) => basename(file))];
  return [
    `cd ${quote(`${target.base}/releases/${release}`)}`,
    ["docker", "compose", "-p", project, "--env-file", "../../config.env", "--env-file", "images.env",
      ...files.flatMap((file) => ["-f", file]), "--profile", "tools", "--profile", "workers", ...composeArgs].map(quote).join(" ")
  ].join(" && ");
}

async function readRemote(target, name) {
  const result = await target.run(`cat ${quote(`${target.base}/${name}`)} 2>/dev/null || true`);
  return result.stdout.trim() || null;
}

async function upload(target, release, manifest, images, extraFiles) {
  const staging = await mkdtemp(join(tmpdir(), "droplet-release-"));
  try {
    await writeFile(join(staging, "release.json"), JSON.stringify(manifest, null, 2) + "\n");
    await writeFile(join(staging, "images.env"), Object.entries(images).map(([key, value]) => `${key}=${value}`).join("\n") + "\n");
    const tarArgs = ["-cf", "-", "-C", root, ...bundleFiles, "-C", join(root, "deploy", "droplet"), ...dropletFiles, "-C", staging, "release.json", "images.env"];
    for (const file of extraFiles) tarArgs.push("-C", dirname(resolve(file)), basename(file));
    const tar = spawn("tar", tarArgs, { stdio: ["ignore", "pipe", "inherit"] });
    const directory = `${target.base}/releases/${release}`;
    await target.run(`mkdir -p ${quote(directory)} && tar -xf - -C ${quote(directory)}`, { input: tar.stdout });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function waitHealthy(target, compose, attempts) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const container = (await target.run(compose(["ps", "-q", "app"]))).stdout.trim();
    if (container) {
      const health = (await target.run(`docker inspect --format '{{.State.Health.Status}}' ${quote(container)}`, { allowFailure: true })).stdout.trim();
      if (health === "healthy") return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
  }
  throw new Error("The web release did not become ready");
}

// Readiness through the public edge: TLS, Caddy and the app together.
export function smoke(url, { insecure = false, attempts = 15 } = {}) {
  const target = new URL("/api/health/ready", url);
  const once = () => new Promise((resolvePromise) => {
    const req = request(target, { rejectUnauthorized: !insecure, timeout: 5000 }, (response) => { response.resume(); resolvePromise(response.statusCode); });
    req.on("error", () => resolvePromise(0));
    req.on("timeout", () => { req.destroy(); resolvePromise(0); });
    req.end();
  });
  return (async () => {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if ((await once()) === 200) return;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
    }
    throw new Error(`Readiness through ${target.origin} did not return 200`);
  })();
}

async function deploy(args) {
  const target = server(args);
  const project = option(args, "--project", "thunderstrux");
  const extraFiles = option(args, "--extra-compose") ? [option(args, "--extra-compose")] : [];
  const attempts = Number(option(args, "--readiness-attempts", "60"));
  const manifestPath = option(args, "--manifest");
  if (!manifestPath) throw new Error("Give --manifest <release.json> from scripts/release-pair.mjs");

  log("validate");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const images = releaseImages(manifest, { local: target.local });
  const release = option(args, "--release", manifest.revision.slice(0, 12));
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(release)) throw new Error("Invalid release name");
  const current = await readRemote(target, "current");
  if (current === release) throw new Error(`Release ${release} is already running`);
  const compose = (composeArgs) => composeCommand(target, release, project, extraFiles, composeArgs);

  log("upload", { release });
  await upload(target, release, manifest, images, extraFiles);
  log("pull", { skipped: target.local || args.includes("--no-pull") });
  if (!target.local && !args.includes("--no-pull")) await target.run(`docker pull ${quote(images.APP_IMAGE)} && docker pull ${quote(images.OPS_IMAGE)}`);
  log("check-config");
  const config = JSON.parse((await target.run(compose(["config", "--format", "json"]))).stdout);
  // The hosted contract holds on the real host; local ids aren't registry digests, so the rehearsal skips it.
  if (!target.local) validateHostedConfig(config);
  if (!config.services.caddy || config.services.app.ports?.length) throw new Error("Only Caddy may publish ports");

  log("stop-workers", { previous: current });
  await target.run(compose(["stop", "-t", "60", ...workerServices]));
  const backupName = `${release}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  log("backup", { backup: backupName });
  await target.run(compose(["run", "--rm", "-e", `BACKUP_NAME=${backupName}`, "backup"]));
  log("migrate");
  await target.run(compose(["run", "--rm", "migration"]));
  log("start-web");
  await target.run(compose(["up", "-d", "--no-deps", "--force-recreate", "app"]));
  log("wait-ready");
  try {
    await waitHealthy(target, compose, attempts);
  } catch (error) {
    await target.run(compose(["stop", "-t", "30", "app"]), { allowFailure: true });
    throw new Error(`${error.message}. The migration ran, so writers remain stopped: inspect, then deploy a fix or roll back with a reviewed compatibility file.`);
  }
  log("start-edge");
  await target.run(compose(["up", "-d", "--no-deps", "caddy"]));
  log("start-workers");
  await target.run(compose(["up", "-d", "--no-deps", "--force-recreate", ...workerServices]));
  const smokeUrl = option(args, "--smoke-url");
  log("smoke", { url: smokeUrl ?? null });
  if (smokeUrl) await smoke(smokeUrl, { insecure: args.includes("--insecure-smoke") });
  log("record", { current: release, previous: current });
  await target.run(`${current ? `printf '%s' ${quote(current)} > ${quote(`${target.base}/previous`)} && ` : ""}printf '%s' ${quote(release)} > ${quote(`${target.base}/current`)}`);
  console.log(JSON.stringify({ status: "deployed", release, web: manifest.web.id, ops: manifest.ops.id, backup: `${backupName}.dump` }));
}

async function rollback(args) {
  const target = server(args);
  const project = option(args, "--project", "thunderstrux");
  const extraFiles = option(args, "--extra-compose") ? [option(args, "--extra-compose")] : [];
  const current = await readRemote(target, "current");
  const to = option(args, "--to", await readRemote(target, "previous"));
  if (!current || !to || to === current) throw new Error("Nothing to roll back to");
  const compatibilityFile = option(args, "--compatibility-file");
  if (!compatibilityFile) throw new Error("Rollback needs --compatibility-file: a reviewed declaration that the older release runs on the current schema");
  const read = async (release) => JSON.parse((await target.run(`cat ${quote(`${target.base}/releases/${release}/release.json`)}`)).stdout);
  const [running, previous] = await Promise.all([read(current), read(to)]);
  // The schema stays as the newer release left it; the declaration says the older code was tested against it.
  await assertRollbackCompatibility(resolve(compatibilityFile), { candidateImageId: running.web.id, previousImageId: previous.web.id, migrationDigest: running.migrationDigest });
  const compose = (composeArgs) => composeCommand(target, to, project, extraFiles, composeArgs);
  log("stop-workers", { from: current, to });
  await target.run(compose(["stop", "-t", "60", ...workerServices]));
  log("start-web");
  await target.run(compose(["up", "-d", "--no-deps", "--force-recreate", "app"]));
  log("wait-ready");
  await waitHealthy(target, compose, Number(option(args, "--readiness-attempts", "60")));
  log("start-workers");
  await target.run(compose(["up", "-d", "--no-deps", "--force-recreate", "caddy", ...workerServices]));
  const smokeUrl = option(args, "--smoke-url");
  if (smokeUrl) await smoke(smokeUrl, { insecure: args.includes("--insecure-smoke") });
  log("record", { current: to, previous: current });
  await target.run(`printf '%s' ${quote(current)} > ${quote(`${target.base}/previous`)} && printf '%s' ${quote(to)} > ${quote(`${target.base}/current`)}`);
  console.log(JSON.stringify({ status: "rolled-back", release: to, web: previous.web.id, ops: previous.ops.id }));
}

async function status(args) {
  const target = server(args);
  const project = option(args, "--project", "thunderstrux");
  const current = await readRemote(target, "current");
  if (!current) throw new Error("No release is deployed");
  const extraFiles = option(args, "--extra-compose") ? [option(args, "--extra-compose")] : [];
  const compose = (composeArgs) => composeCommand(target, current, project, extraFiles, composeArgs);
  console.log(JSON.stringify({ current, previous: await readRemote(target, "previous") }));
  console.log((await target.run(compose(["ps", "--format", "table {{.Service}}\t{{.Status}}"]))).stdout);
  console.log((await target.run(compose(["run", "--rm", "--no-deps", "migration", "node", "scripts/workers.mjs", "status"]))).stdout);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const commands = { deploy, rollback, status };
  if (!commands[command]) throw new Error("Usage: droplet.mjs deploy|rollback|status (--host <user@address> | --local <dir>) ...");
  commands[command](args).catch((error) => {
    console.error(JSON.stringify({ event: "droplet.failed", command, message: error.message }));
    process.exitCode = 1;
  });
}
