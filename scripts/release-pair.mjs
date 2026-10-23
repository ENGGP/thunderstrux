// T43: a release is a pair of images built from one revision: web (Next's
// standalone server) and ops (migrations, workers and tools). The manifest
// ties them to the revision and the migration chain, and the budgets keep
// both images from growing unnoticed.
//
//   node scripts/release-pair.mjs --web <image> --ops <image> [--out manifest.json]
import { spawnSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrationDigest } from "./operations-guards.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MiB = 1024 * 1024;

// Uncompressed, summed over the image's layers. Raise one only with a measured
// reason and an owner recorded in Production Operations.
export const imageBudgets = { web: 600 * MiB, ops: 1024 * MiB };

const imageId = /^sha256:[0-9a-f]{64}$/;

export function validateReleaseManifest(manifest) {
  if (manifest?.version !== 1) throw new Error("Release manifest version must be 1");
  if (!/^[0-9a-f]{40}$/.test(manifest.revision ?? "")) throw new Error("Release manifest needs the full git revision");
  for (const role of ["web", "ops"]) {
    const image = manifest[role];
    if (!imageId.test(image?.id ?? "")) throw new Error(`${role} image needs an immutable sha256 id`);
    if (!Number.isInteger(image.sizeBytes) || image.sizeBytes <= 0) throw new Error(`${role} image needs its measured size`);
    if (image.sizeBytes > imageBudgets[role]) {
      throw new Error(`${role} image is ${(image.sizeBytes / MiB).toFixed(1)} MiB, over its ${imageBudgets[role] / MiB} MiB budget`);
    }
  }
  if (manifest.web.id === manifest.ops.id) throw new Error("web and ops must be different images");
  if (!/^[0-9a-f]{64}$/.test(manifest.migrationDigest ?? "")) throw new Error("Release manifest needs the migration digest");
  if (!/^\d{14}_[a-z0-9_]+$/.test(manifest.requiredMigration ?? "")) throw new Error("Release manifest needs the required migration");
  return manifest;
}

function docker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr.trim().slice(-500)}`);
  return result.stdout.trim();
}

export function inspectImage(ref) {
  const sizeBytes = docker(["history", "-H=false", "--format", "{{.Size}}", ref]).split("\n").reduce((total, line) => total + Number(line || 0), 0);
  return { ref, id: docker(["image", "inspect", "--format", "{{.Id}}", ref]), sizeBytes };
}

export function gitRevision() {
  return spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout?.trim() ?? "";
}

export async function chainDigest() {
  const migrations = resolve(root, "prisma", "migrations");
  const entries = [];
  for (const directory of await readdir(migrations, { withFileTypes: true })) {
    if (directory.isDirectory()) entries.push({ name: directory.name, contents: await readFile(join(migrations, directory.name, "migration.sql"), "utf8") });
  }
  return migrationDigest(entries);
}

export async function describeReleasePair({ web, ops, revision }) {
  const manifest = {
    version: 1,
    revision,
    createdAt: new Date().toISOString(),
    web: inspectImage(web),
    ops: inspectImage(ops),
    requiredMigration: JSON.parse(await readFile(resolve(root, "config", "schema-contract.json"), "utf8")).requiredMigration,
    migrationDigest: await chainDigest()
  };
  return validateReleaseManifest(manifest);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = (name) => { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; };
  const web = option("--web");
  const ops = option("--ops");
  if (!web || !ops) throw new Error("Usage: release-pair.mjs --web <image> --ops <image> [--out manifest.json]");
  const manifest = await describeReleasePair({ web, ops, revision: gitRevision() });
  const out = option("--out");
  if (out) await writeFile(out, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(manifest, null, 2));
}
