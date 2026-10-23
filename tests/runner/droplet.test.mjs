import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deploySteps, quote, releaseImages } from "../../scripts/droplet.mjs";

// T43b: the pilot-host deploy's ordering, image and edge contracts. The full
// deploy, upgrade, rollback and failed-release path runs in
// scripts/rehearse-droplet.mjs.
const MiB = 1024 * 1024;
const manifest = (refs = {}) => ({
  version: 1,
  revision: "a".repeat(40),
  web: { ref: refs.web ?? `ghcr.io/enggp/thunderstrux@sha256:${"1".repeat(64)}`, id: `sha256:${"3".repeat(64)}`, sizeBytes: 390 * MiB },
  ops: { ref: refs.ops ?? `ghcr.io/enggp/thunderstrux-ops@sha256:${"2".repeat(64)}`, id: `sha256:${"4".repeat(64)}`, sizeBytes: 940 * MiB },
  requiredMigration: "20261112010000_worker_leases",
  migrationDigest: "f".repeat(64)
});

test("a deploy stops writers before the backup, migrates after it, and restarts workers only on a ready web release", () => {
  const at = (step) => deploySteps.indexOf(step);
  for (const step of ["stop-workers", "backup", "migrate", "start-web", "wait-ready", "start-workers", "record"]) assert.ok(at(step) >= 0, step);
  assert.ok(at("stop-workers") < at("backup"));
  assert.ok(at("backup") < at("migrate"));
  assert.ok(at("migrate") < at("start-web"));
  assert.ok(at("wait-ready") < at("start-edge"));
  assert.ok(at("wait-ready") < at("start-workers"));
  assert.equal(deploySteps.at(-1), "record");
});

test("a real host deploys registry digests only; the local rehearsal deploys image ids", () => {
  assert.deepEqual(releaseImages(manifest(), { local: false }), { APP_IMAGE: manifest().web.ref, OPS_IMAGE: manifest().ops.ref });
  assert.deepEqual(releaseImages(manifest(), { local: true }), { APP_IMAGE: manifest().web.id, OPS_IMAGE: manifest().ops.id });
  assert.throws(() => releaseImages(manifest({ web: "thunderstrux-app:latest" }), { local: false }), /@sha256/);
  assert.throws(() => releaseImages({ ...manifest(), revision: "main" }, { local: true }), /revision/);
});

test("server commands quote their arguments", () => {
  assert.equal(quote("it's"), "'it'\\''s'");
  assert.equal(quote("a b; rm -rf /"), "'a b; rm -rf /'");
});

// Windows checkouts may have CRLF line endings.
const text = async (path) => (await readFile(path, "utf8")).replace(/\r\n/g, "\n");

test("the edge overwrites the client address the app trusts, and every hosted secret is a file on the Droplet", async () => {
  const caddy = await text("deploy/droplet/Caddyfile");
  assert.match(caddy, /header_up X-Thunderstrux-Client-IP \{remote_host\}/);
  assert.match(caddy, /max_size 6MB/);
  const overlay = await text("deploy/droplet/docker-compose.droplet.yml");
  assert.match(overlay, /RATE_LIMIT_TRUSTED_PROXY_HEADER: x-thunderstrux-client-ip/);
  const hosted = (await text("docker-compose.hosted.yml")) + (await text("docker-compose.assets.hosted.yml"));
  const secrets = [...hosted.matchAll(/^ {2}([a-z_]+):\n {4}external: true/gm)].map(([, name]) => name);
  assert.ok(secrets.length >= 12, `found ${secrets.length} hosted secrets`);
  for (const name of secrets) assert.match(overlay, new RegExp(`^  ${name}:\\n    <<: \\*secret-file\\n    file: .*/${name}$`, "m"), name);
});
