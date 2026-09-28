import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const composeArgs = [
  "compose",
  "-f",
  "docker-compose.yml",
  "-f",
  "docker-compose.dev.yml"
];

function runDocker(args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync("docker", args, {
    cwd: process.cwd(),
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = capture ? String(result.stderr || result.stdout || "").trim() : "";
    throw new Error(`docker ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

export function dependencyVolumePlan(config) {
  const projectName = config?.name;
  const volumeName = config?.volumes?.node_modules?.name;
  const dependencyMount = config?.services?.app?.volumes?.find(
    (mount) => mount?.type === "volume" && mount?.target === "/app/node_modules"
  );

  if (typeof projectName !== "string" || !projectName) {
    throw new Error("Development Compose project name is missing");
  }
  if (typeof volumeName !== "string" || !volumeName) {
    throw new Error("Development node_modules volume is missing from Compose config");
  }
  if (dependencyMount?.source !== "node_modules") {
    throw new Error("App /app/node_modules mount is not the Compose dependency volume");
  }

  return { projectName, volumeName };
}

export function assertDependencyVolume(volume, plan) {
  const labels = volume?.Labels ?? {};
  if (
    volume?.Name !== plan.volumeName ||
    labels["com.docker.compose.volume"] !== "node_modules" ||
    labels["com.docker.compose.project"] !== plan.projectName
  ) {
    throw new Error(`Refusing to remove unverified dependency volume ${plan.volumeName}`);
  }
}

function developmentDependencyVolume() {
  const configured = runDocker([...composeArgs, "config", "--format", "json"], {
    capture: true
  });
  return dependencyVolumePlan(JSON.parse(configured.stdout));
}

function removeDependencyCache(plan) {
  const inspected = runDocker(["volume", "inspect", plan.volumeName], {
    capture: true,
    allowFailure: true
  });
  if (inspected.status !== 0) return;

  const [volume] = JSON.parse(inspected.stdout);
  assertDependencyVolume(volume, plan);
  runDocker(["volume", "rm", plan.volumeName]);
}

function verifyRuntimeDependencies() {
  const check =
    "Promise.all([import('@redis/client'), import('@prisma/client')]).then(() => console.log('Runtime dependencies ready'))";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = runDocker(
      [...composeArgs, "exec", "-T", "app", "node", "-e", check],
      { capture: true, allowFailure: true }
    );
    if (result.status === 0) {
      process.stdout.write(result.stdout);
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error("App runtime dependencies were not ready after 60 seconds");
}

export function recreateDevelopmentApp() {
  runDocker([...composeArgs, "build", "app"]);
  const plan = developmentDependencyVolume();
  runDocker([...composeArgs, "rm", "-s", "-f", "app"]);
  removeDependencyCache(plan);
  runDocker([...composeArgs, "up", "-d", "app"]);
  verifyRuntimeDependencies();
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) recreateDevelopmentApp();
