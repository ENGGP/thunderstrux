// T43b: rehearse the pilot-host deploy before the Droplet exists. This machine
// stands in for the Droplet (scripts/droplet.mjs --local), and two throwaway
// containers stand in for the managed PostgreSQL 16 (a _test database) and
// Valkey. It deploys a release, upgrades to a second, rolls back with a
// reviewed declaration, then shows a release that can't become ready leaves
// writers stopped. Everything it creates is removed at the end.
//
//   node scripts/rehearse-droplet.mjs
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deploySteps, workerServices } from "./droplet.mjs";
import { describeReleasePair, gitRevision } from "./release-pair.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = `droplet-${randomBytes(5).toString("hex")}`;
const dir = join(root, "tmp", "droplet", run);
const network = `${run}-managed`;
const postgresImage = "postgres:16@sha256:1a6ab3f5345eb6dbe04a1349529caabdb0ab09293a09590fad07b2246bfa4b54";
const valkeyImage = "redis:7-alpine@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499";

function command(executable, args, { allowFailure = false, env } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { cwd: root, env: { ...process.env, MSYS_NO_PATHCONV: "1", ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 || allowFailure ? resolvePromise({ code, output }) : reject(new Error(`${executable} ${args[0]} exited ${code}: ${output.slice(-2500)}`))));
  });
}
const docker = (args, options) => command("docker", args, options);
const droplet = (args, options) => command(process.execPath, ["scripts/droplet.mjs", ...args, "--local", dir, "--project", run, "--extra-compose", join(dir, "rehearsal.yml")], options);
const steps = (output) => output.split(/\r?\n/).filter((line) => line.startsWith("{\"event\":\"droplet.step\"")).map((line) => JSON.parse(line).step);
const freePort = () => new Promise((resolvePromise) => { const server = createServer().listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolvePromise(port)); }); });
const expect = (condition, message) => { if (!condition) throw new Error(message); };

async function containerImage(service) {
  const id = (await docker(["ps", "-q", "--filter", `label=com.docker.compose.project=${run}`, "--filter", `label=com.docker.compose.service=${service}`])).output.trim();
  return id ? (await docker(["inspect", "--format", "{{.Image}}", id])).output.trim() : null;
}

async function expectRunning(manifest, label) {
  expect(await containerImage("app") === manifest.web.id, `${label}: the app isn't running the release's web image`);
  for (const service of workerServices) expect(await containerImage(service) === manifest.ops.id, `${label}: ${service} isn't running the release's ops image`);
}

// One release pair per name. Releases differ by a label only, which gives each its own image ids.
async function buildRelease(name) {
  const web = `thunderstrux-app:${run}-${name}`;
  const ops = `thunderstrux-ops:${run}-${name}`;
  for (const [target, tag] of [["web", web], ["ops", ops]]) {
    await docker(["build", "-q", "--target", target, "--label", `thunderstrux.rehearsal=${run}-${name}`, "-t", tag, "-f", "docker/Dockerfile", "."]);
  }
  const manifest = await describeReleasePair({ web, ops, revision: gitRevision() });
  await writeFile(join(dir, `${name}.json`), JSON.stringify(manifest, null, 2));
  return manifest;
}

let passed = false;
try {
  await mkdir(join(dir, "secrets"), { recursive: true });
  await mkdir(join(dir, "backups"), { recursive: true });
  const httpsPort = await freePort();
  const site = `https://localhost:${httpsPort}`;

  // Stand-ins for the managed services, reachable only on their own network.
  await docker(["network", "create", network]);
  await docker(["run", "-d", "--name", `${run}-postgres`, "--network", network, "--network-alias", "managed-postgres",
    "-e", "POSTGRES_USER=droplet", "-e", "POSTGRES_PASSWORD=droplet-disposable-only", "-e", "POSTGRES_DB=droplet_app_test", postgresImage]);
  await docker(["run", "-d", "--name", `${run}-valkey`, "--network", network, "--network-alias", "managed-valkey", valkeyImage]);
  await writeFile(join(dir, "rehearsal.yml"), [
    "# Joins the release to the stand-in managed services (rehearsal only).",
    "networks:",
    "  managed:",
    "    external: true",
    `    name: ${network}`,
    "services:",
    ...["app", "migration", "backup", ...workerServices].flatMap((service) => [`  ${service}:`, "    networks: [default, managed]"])
  ].join("\n") + "\n");

  const secrets = {
    database_url: "postgresql://droplet:droplet-disposable-only@managed-postgres:5432/droplet_app_test?schema=public",
    auth_secret: randomBytes(32).toString("hex"),
    mfa_encryption_key: randomBytes(32).toString("base64"),
    notification_encryption_key: randomBytes(32).toString("base64"),
    rate_limit_redis_url: "redis://managed-valkey:6379",
    stripe_secret_key: "sk_test_rehearsal_placeholder",
    stripe_webhook_secret: "whsec_rehearsal_placeholder",
    stripe_connect_webhook_secret: "whsec_rehearsal_connect_placeholder",
    stripe_accounts_webhook_secret: "whsec_rehearsal_accounts_placeholder",
    resend_api_key: "re_rehearsal_placeholder",
    // Unreachable on purpose: alert delivery is best effort and must not affect a deploy.
    alert_webhook_url: "http://127.0.0.1:9/alerts",
    asset_storage_access_key: "rehearsal-access",
    asset_storage_secret_key: "rehearsal-secret"
  };
  // The containers run as uid 1000; on the Droplet these files belong to that user (0400).
  for (const [name, value] of Object.entries(secrets)) await writeFile(join(dir, "secrets", name), value, { mode: 0o444 });
  const config = (await readFile(join(root, "deploy", "droplet", "config.env.example"), "utf8"))
    .replace(/^SITE_ADDRESS=.*$/m, "SITE_ADDRESS=localhost")
    .replace(/^ACME_EMAIL=.*$/m, "ACME_EMAIL=rehearsal@example.com")
    .replace(/^(AUTH_URL|NEXTAUTH_URL|NEXT_PUBLIC_APP_URL|TRUSTED_APP_ORIGINS)=.*$/gm, `$1=${site}`)
    .replace(/^ASSET_STORAGE_ENDPOINT=.*$/m, "ASSET_STORAGE_ENDPOINT=http://127.0.0.1:9")
    .replace(/^THUNDERSTRUX_SECRETS_DIR=.*$/m, `THUNDERSTRUX_SECRETS_DIR=${join(dir, "secrets").replace(/\\/g, "/")}`)
    .replace(/^THUNDERSTRUX_BACKUP_DIR=.*$/m, `THUNDERSTRUX_BACKUP_DIR=${join(dir, "backups").replace(/\\/g, "/")}`)
    + `CADDY_HTTPS_PORT=${httpsPort}\nCADDY_HTTP_PORT=${await freePort()}\n`;
  await writeFile(join(dir, "config.env"), config);

  const [one, two, three] = [await buildRelease("one"), await buildRelease("two"), await buildRelease("three")];

  // 1. The first release, through Caddy's HTTPS edge.
  const first = await droplet(["deploy", "--manifest", join(dir, "one.json"), "--release", "one", "--smoke-url", site, "--insecure-smoke"]);
  expect(steps(first.output).join() === deploySteps.join(), `Deploy steps ran out of order: ${steps(first.output)}`);
  await expectRunning(one, "first deploy");
  expect((await readdir(join(dir, "backups"))).some((file) => file.startsWith("one-") && file.endsWith(".dump")), "The pre-migration backup is missing");
  // The schedules loop runs each worker at once; the monitor's first run proves the ops image reaches the database.
  let monitorLogs = "";
  for (let attempt = 0; attempt < 45 && !monitorLogs.includes("\"worker.succeeded\""); attempt += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
    monitorLogs = (await docker(["logs", (await docker(["ps", "-q", "--filter", `label=com.docker.compose.project=${run}`, "--filter", "label=com.docker.compose.service=monitor-worker"])).output.trim()], { allowFailure: true })).output;
  }
  expect(monitorLogs.includes("\"worker.succeeded\""), "The scheduled monitor worker never succeeded");

  // 2. An upgrade.
  await droplet(["deploy", "--manifest", join(dir, "two.json"), "--release", "two", "--smoke-url", site, "--insecure-smoke"]);
  await expectRunning(two, "upgrade");
  expect((await readFile(join(dir, "previous"), "utf8")) === "one", "The previous release wasn't recorded");

  // 3. Rollback needs a reviewed declaration; without one it refuses.
  const refused = await droplet(["rollback", "--smoke-url", site, "--insecure-smoke"], { allowFailure: true });
  expect(refused.code !== 0 && refused.output.includes("compatibility-file"), "Rollback ran without a compatibility declaration");
  await writeFile(join(dir, "rollback.json"), JSON.stringify({ candidateImageId: two.web.id, previousImageId: one.web.id, migrationDigest: two.migrationDigest, reviewed: true }));
  await droplet(["rollback", "--compatibility-file", join(dir, "rollback.json"), "--smoke-url", site, "--insecure-smoke"]);
  await expectRunning(one, "rollback");
  expect((await readFile(join(dir, "current"), "utf8")) === "one", "Rollback didn't record the release");

  // 4. A release that can't become ready (Valkey is down): the deploy stops, writers stay stopped.
  await docker(["stop", `${run}-valkey`]);
  const failed = await droplet(["deploy", "--manifest", join(dir, "three.json"), "--release", "three", "--readiness-attempts", "5"], { allowFailure: true });
  expect(failed.code !== 0 && failed.output.includes("writers remain stopped"), `A failed deploy didn't stop: ${failed.output.slice(-1500)}`);
  expect(await containerImage("app") === null, "The app kept running after a failed deploy");
  for (const service of workerServices) expect(await containerImage(service) === null, `${service} kept running after a failed deploy`);
  expect((await readFile(join(dir, "current"), "utf8")) === "one", "A failed deploy changed the recorded release");
  expect(three.web.id !== one.web.id, "Release three should be its own image");

  // The operator's view.
  await docker(["start", `${run}-valkey`]);
  const status = await droplet(["status"]);
  expect(status.output.includes("\"current\":\"one\""), "Status doesn't show the running release");

  passed = true;
  console.log(JSON.stringify({ status: "passed", run, releases: { one: one.web.id, two: two.web.id }, steps: deploySteps }));
} finally {
  // Remove everything this run created: containers, volumes, the network, images and its folder.
  const owned = (await docker(["ps", "-aq", "--filter", `label=com.docker.compose.project=${run}`], { allowFailure: true })).output.split(/\s+/).filter(Boolean);
  if (owned.length) await docker(["rm", "-fv", ...owned], { allowFailure: true });
  await docker(["rm", "-fv", `${run}-postgres`, `${run}-valkey`], { allowFailure: true });
  const volumes = (await docker(["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${run}`], { allowFailure: true })).output.split(/\s+/).filter(Boolean);
  if (volumes.length) await docker(["volume", "rm", ...volumes], { allowFailure: true });
  for (const name of [network, `${run}_default`]) await docker(["network", "rm", name], { allowFailure: true });
  for (const name of ["one", "two", "three"]) await docker(["rmi", `thunderstrux-app:${run}-${name}`, `thunderstrux-ops:${run}-${name}`], { allowFailure: true });
  if (passed) await rm(dir, { recursive: true, force: true });
  else console.error(`Rehearsal ${run} failed; its folder ${dir} is kept for inspection.`);
}
