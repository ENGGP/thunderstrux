import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

// T44d: `next build` inlines every literal `process.env.NEXT_PUBLIC_*` into the
// bundles, which tied a release image to the domain it was built for. The app
// reads its origin through lib/app-url.ts instead, so one image serves any domain.
async function sources(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await sources(path));
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) found.push(path);
  }
  return found;
}

test("application code never reads a NEXT_PUBLIC_ variable that the build would bake in", async () => {
  const files = [...await sources("app"), ...await sources("components"), ...await sources("lib"), "proxy.ts", "auth.ts", "next.config.ts"];
  const offenders = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    if (/process\.env\.NEXT_PUBLIC_|process\.env\[["'`]NEXT_PUBLIC_/.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

test("the release Dockerfile builds no origin into the image", async () => {
  const dockerfile = await readFile("docker/Dockerfile", "utf8");
  assert.doesNotMatch(dockerfile, /NEXT_PUBLIC_APP_URL=|APP_ORIGIN/);
});
