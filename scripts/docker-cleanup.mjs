// Docker cleanup after implementation and testing. A dry run by default:
//
//   pnpm docker:cleanup            what would go, and what stays and why
//   pnpm docker:cleanup --apply    removes it, and caps the build cache
//
// This Docker also holds the dev stack, the preview and other projects' data, so
// this never prunes: `docker volume prune` would delete another project's database.
// It removes only what a test run or rehearsal made, by exact name and never by force.
// Deployed release images stay out of it: a rollback needs them.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runIdPattern } from "./e2e-guards.mjs";

const rehearsalPattern = /^(ops|droplet)-[a-f0-9]{10}$/;
const projectLabel = "com.docker.compose.project";
const stoppedStates = new Set(["created", "exited", "dead"]);
// #235 stopped setting these; only the tests image keeps a `:local` tag, for tools.
const retiredTags = new Set(["thunderstrux-e2e-app:local", "thunderstrux-e2e-ops:local"]);
// A run in its build phase has tags but no containers yet, so an idle project may
// be a live one. No build takes this long; a live run after that has containers up.
export const graceMs = 2 * 60 * 60 * 1000;
// Most of the cache is old builds, but what's left keeps the next build quick.
export const buildCacheCap = "12GB";

export const isRunProject = (name) => runIdPattern.test(name ?? "") || rehearsalPattern.test(name ?? "");

// The run an image tag belongs to, or null for every tag this mustn't touch.
export function runOfTag(tag) {
  const e2e = /^thunderstrux-e2e-(?:app|ops|tests):(.+)$/.exec(tag)?.[1];
  if (e2e) return runIdPattern.test(e2e) ? e2e : null;
  const rehearsal = /^thunderstrux-(?:app|ops):((?:ops|droplet)-[a-f0-9]{10})-[a-z-]+$/.exec(tag)?.[1];
  return rehearsal ?? null;
}

// Docker reports a zero time for what it doesn't know, which would read as very old.
const knownTime = (value) => {
  const time = Date.parse(value ?? "");
  return time > Date.UTC(2000, 0, 1) ? time : null;
};

function reasonToKeep(project, { containers, times }, now) {
  // Its volume can hold Stripe recovery state; pnpm test:e2e:cleanup decides that.
  if (project.startsWith("staging-")) return "a staging run: pnpm test:e2e:cleanup <run-id> decides";
  if (containers.some((container) => !stoppedStates.has(container.State?.Status))) return "containers are running";
  if (times.some((time) => time === null)) return "its age is unknown";
  if (Math.max(...times) > now - graceMs) return "active in the last 2 hours";
  return null;
}

// Images no tag names, made by a run or rehearsal. Nothing can start one by name,
// and only a container already using it could need it.
export function untaggedRunImages(images, containers) {
  const inUse = new Set(containers.map((container) => container.Image));
  return images.filter((image) => !image.RepoTags?.length && isRunProject(image.Config?.Labels?.[projectLabel]) && !inUse.has(image.Id));
}

// Decides from `docker inspect` output, with nothing removed here.
export function planCleanup({ containers, volumes, networks, images }, now = Date.now()) {
  const projects = new Map();
  const owned = (name) => {
    if (!projects.has(name)) projects.set(name, { containers: [], networks: [], volumes: [], tags: [], times: [] });
    return projects.get(name);
  };
  for (const container of containers) {
    const project = container.Config?.Labels?.[projectLabel];
    if (!isRunProject(project)) continue;
    owned(project).containers.push(container);
    owned(project).times.push(knownTime(container.Created));
  }
  for (const network of networks) {
    if (!isRunProject(network.Labels?.[projectLabel])) continue;
    owned(network.Labels[projectLabel]).networks.push(network);
    owned(network.Labels[projectLabel]).times.push(knownTime(network.Created));
  }
  for (const volume of volumes) {
    if (!isRunProject(volume.Labels?.[projectLabel])) continue;
    owned(volume.Labels[projectLabel]).volumes.push(volume);
    owned(volume.Labels[projectLabel]).times.push(knownTime(volume.CreatedAt));
  }
  for (const image of images) {
    for (const tag of image.RepoTags ?? []) {
      const project = runOfTag(tag);
      if (!project) continue;
      owned(project).tags.push(tag);
      owned(project).times.push(knownTime(image.Metadata?.LastTagTime));
    }
  }

  const remove = [];
  const keep = [];
  for (const [project, resources] of projects) {
    const reason = reasonToKeep(project, resources, now);
    if (reason) {
      keep.push({ target: project, reason });
      continue;
    }
    // In this order, so nothing is still using what goes next.
    remove.push(
      ...resources.containers.map((container) => ({ kind: "container", target: container.Id, label: container.Name, reason: `${project} finished` })),
      ...resources.networks.map((network) => ({ kind: "network", target: network.Id, label: network.Name, reason: `${project} finished` })),
      ...resources.volumes.map((volume) => ({ kind: "volume", target: volume.Name, label: volume.Name, reason: `${project} finished` })),
      ...resources.tags.map((tag) => ({ kind: "image", target: tag, label: tag, reason: `${project} finished` }))
    );
  }
  for (const image of images) {
    for (const tag of image.RepoTags ?? []) {
      if (!retiredTags.has(tag)) continue;
      const taggedAt = knownTime(image.Metadata?.LastTagTime);
      if (taggedAt !== null && taggedAt <= now - graceMs) remove.push({ kind: "image", target: tag, label: tag, reason: "no longer used" });
      else keep.push({ target: tag, reason: "tagged in the last 2 hours" });
    }
  }
  for (const image of untaggedRunImages(images, containers)) {
    remove.push({ kind: "image", target: image.Id, label: `untagged ${image.Id.slice(7, 19)}`, reason: `left by ${image.Config.Labels[projectLabel]}` });
  }
  return { remove, keep };
}

// One place, so a test can prove nothing here ever forces or prunes.
export function removalArgs({ kind, target }) {
  if (kind === "container") return ["rm", "-v", target];
  if (kind === "network") return ["network", "rm", target];
  if (kind === "volume") return ["volume", "rm", target];
  if (kind === "image") return ["image", "rm", target];
  throw new Error(`Unknown resource kind: ${kind}`);
}

export const parseCleanupArgs = (args) => {
  const unknown = args.filter((arg) => arg !== "--" && arg !== "--apply");
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}. Usage: pnpm docker:cleanup [--apply]`);
  return { apply: args.includes("--apply") };
};

function docker(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolvePromise(output) : reject(new Error(`docker ${args.slice(0, 2).join(" ")} failed: ${output.trim().slice(-300)}`))));
  });
}

// Something vanishing mid-read rejects here, so a changing host means no plan at all.
async function inspectAll(run, list, inspect) {
  const ids = [...new Set((await run(list)).split(/\s+/).filter(Boolean))];
  return ids.length ? JSON.parse(await run([...inspect, ...ids])) : [];
}
const readContainers = (run) => inspectAll(run, ["ps", "-aq", "--no-trunc"], ["container", "inspect"]);
const readImages = (run) => inspectAll(run, ["image", "ls", "-aq", "--no-trunc"], ["image", "inspect"]);

// Each run calls this as it finishes: setting `:local` on its tests image left the
// last run's with no tag. A run in progress can't lose anything, since it uses tags.
export async function removeUntaggedRunImages(run = docker) {
  const [images, containers] = await Promise.all([readImages(run), readContainers(run)]);
  for (const image of untaggedRunImages(images, containers)) await run(["image", "rm", image.Id]).catch(() => undefined);
}

export const readInventory = async (run = docker) => ({
  containers: await readContainers(run),
  volumes: await inspectAll(run, ["volume", "ls", "-q"], ["volume", "inspect"]),
  networks: await inspectAll(run, ["network", "ls", "-q", "--no-trunc"], ["network", "inspect"]),
  images: await readImages(run)
});

async function main() {
  const { apply } = parseCleanupArgs(process.argv.slice(2));
  const { remove, keep } = planCleanup(await readInventory());

  for (const { target, reason } of keep) console.log(`keep    ${target}: ${reason}`);
  let failed = 0;
  for (const item of remove) {
    try {
      if (apply) await docker(removalArgs(item));
      console.log(`${apply ? "removed" : "remove "} ${item.kind} ${item.label}: ${item.reason}`);
    } catch (error) {
      failed += 1;
      console.error(`failed  ${item.kind} ${item.label}: ${error.message}`);
    }
  }
  if (!remove.length) console.log("Nothing left by a run or rehearsal to remove.");
  if (apply) {
    // Never pruned empty: unused cache over the cap goes, oldest first.
    await docker(["builder", "prune", "--force", "--max-used-space", buildCacheCap]);
    console.log(`Build cache capped at ${buildCacheCap}.`);
  } else console.log(`Dry run: nothing removed. --apply removes this and caps the build cache at ${buildCacheCap}.`);
  console.log(await docker(["system", "df"]));
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
