import assert from "node:assert/strict";
import test from "node:test";
import { buildCacheCap, graceMs, isRunProject, parseCleanupArgs, planCleanup, removalArgs, runOfTag, untaggedRunImages } from "../../scripts/docker-cleanup.mjs";

const now = Date.parse("2026-10-31T12:00:00Z");
const old = new Date(now - graceMs - 60_000).toISOString();
const recent = new Date(now - 60_000).toISOString();
const baseline = `baseline-${"a".repeat(24)}`;
const browser = `browser-${"b".repeat(24)}`;
const staging = `staging-${"c".repeat(24)}`;
const rehearsal = "ops-f62fbfe041";

const label = (project) => (project ? { "com.docker.compose.project": project } : {});
const container = (project, { status = "exited", created = old, image = "sha256:used" } = {}) => ({ Id: `container-${project}-${status}`, Name: `/${project}-db-1`, Image: image, Created: created, State: { Status: status }, Config: { Labels: label(project) } });
const volume = (project, created = old) => ({ Name: `${project}_test_database`, CreatedAt: created, Labels: label(project) });
const network = (project, created = old) => ({ Id: `network-${project}`, Name: `${project}_default`, Created: created, Labels: label(project) });
const image = (tags, { taggedAt = old, project, id = `sha256:${tags[0] ?? project}` } = {}) => ({ Id: id, RepoTags: tags, Config: { Labels: label(project) }, Metadata: { LastTagTime: taggedAt } });
const plan = (inventory) => planCleanup({ containers: [], volumes: [], networks: [], images: [], ...inventory }, now);
const targets = (result) => result.remove.map((item) => item.target);

test("only exact run and rehearsal names count, so the host's other projects can't match", () => {
  for (const name of [baseline, browser, staging, rehearsal, "droplet-0123456789"]) assert.equal(isRunProject(name), true, name);
  for (const name of ["thunderstrux", "ops-preview", "personal_website", "baseline", `baseline-${"a".repeat(23)}`, `baseline-${"A".repeat(24)}`, `x${baseline}`, `${baseline}x`, "ops-f62fbfe04", "", undefined, null]) {
    assert.equal(isRunProject(name), false, String(name));
  }
  assert.equal(runOfTag(`thunderstrux-e2e-tests:${baseline}`), baseline);
  assert.equal(runOfTag(`thunderstrux-ops:${rehearsal}-migration-fail`), rehearsal);
  assert.equal(runOfTag(`thunderstrux-app:droplet-0123456789-two`), "droplet-0123456789");
  for (const tag of ["thunderstrux-app:dev", "thunderstrux-app:961dbaf", "thunderstrux-ops:d133734", "thunderstrux-assets:local", "thunderstrux-e2e-tests:local", "thunderstrux-e2e-tests:latest", `thunderstrux-e2e-tests:${baseline}x`, "postgres:16", `other-app:${baseline}`, `thunderstrux-ops:ops-preview-one`]) {
    assert.equal(runOfTag(tag), null, tag);
  }
});

test("everything else on this host is left alone: dev, the preview, other projects and release images", () => {
  const result = plan({
    containers: [container("thunderstrux"), container("ops-preview"), container("personal_website"), container(undefined)],
    volumes: [volume("thunderstrux"), volume("ops-preview"), volume("personal_website"), volume(undefined)],
    networks: [network("thunderstrux"), network("ops-preview"), network(undefined)],
    images: [
      image(["thunderstrux-app:dev"]), image(["thunderstrux-app:961dbaf"], { project: "ops-preview" }), image(["thunderstrux-ops:d133734"]), image(["thunderstrux-assets:local"]),
      image(["thunderstrux-e2e-tests:local"], { project: browser }), image(["postgres:16"]),
      // Pulled by digest: no tag, but a compose file still pins it.
      { Id: "sha256:postgres", RepoTags: [], RepoDigests: ["postgres@sha256:1"], Config: { Labels: {} }, Metadata: {} },
      image([], { project: "personal_website", id: "sha256:theirs" }), image([], { id: "sha256:unlabelled" })
    ]
  });
  assert.deepEqual(result, { remove: [], keep: [] });
});

test("a finished run goes completely, in the order Docker needs", () => {
  const result = plan({
    containers: [container(baseline)], networks: [network(baseline)], volumes: [volume(baseline)],
    images: [image([`thunderstrux-e2e-app:${baseline}`]), image([`thunderstrux-e2e-tests:${baseline}`])]
  });
  assert.deepEqual(result.remove.map((item) => item.kind), ["container", "network", "volume", "image", "image"]);
  assert.deepEqual(targets(result).slice(-2), [`thunderstrux-e2e-app:${baseline}`, `thunderstrux-e2e-tests:${baseline}`]);
});

test("one running container keeps the whole run, whatever its age or state", () => {
  const states = ["running", "paused", "restarting", "removing"].map((status) => container(baseline, { status }));
  for (const live of [...states, { ...container(baseline), State: undefined }]) {
    const result = plan({
      containers: [container(baseline), live],
      volumes: [volume(baseline)], images: [image([`thunderstrux-e2e-app:${baseline}`])]
    });
    assert.deepEqual(result.remove, [], live.State?.Status);
    assert.deepEqual(result.keep, [{ target: baseline, reason: "containers are running" }]);
  }
});

test("a run in its build phase keeps its tags, though it has no containers yet", () => {
  const result = plan({ images: [image([`thunderstrux-e2e-app:${browser}`], { taggedAt: recent })] });
  assert.deepEqual(result.remove, []);
  assert.deepEqual(result.keep, [{ target: browser, reason: "active in the last 2 hours" }]);
});

test("a run's newest resource decides, so an old tag can't clear a project still in use", () => {
  const result = plan({ volumes: [volume(baseline, recent)], images: [image([`thunderstrux-e2e-app:${baseline}`])] });
  assert.deepEqual(result.remove, []);
});

test("a resource at exactly the grace is old enough, and one a moment younger isn't", () => {
  const at = (ms) => image([`thunderstrux-e2e-app:${baseline}`], { taggedAt: new Date(ms).toISOString() });
  assert.equal(plan({ images: [at(now - graceMs)] }).remove.length, 1);
  assert.equal(plan({ images: [at(now - graceMs + 1)] }).remove.length, 0);
});

test("an unknown age keeps a run: Docker's zero time must not read as very old", () => {
  for (const taggedAt of [null, "", "0001-01-01T00:00:00Z", "not a date"]) {
    const result = plan({ images: [image([`thunderstrux-e2e-app:${baseline}`], { taggedAt })] });
    assert.deepEqual(result.remove, [], String(taggedAt));
    assert.deepEqual(result.keep, [{ target: baseline, reason: "its age is unknown" }]);
  }
});

test("a staging run is never removed, however old: its volume can hold Stripe recovery state", () => {
  const result = plan({ containers: [container(staging)], volumes: [volume(staging)], networks: [network(staging)], images: [image([`thunderstrux-e2e-app:${staging}`])] });
  assert.deepEqual(result.remove, []);
  assert.match(result.keep[0].reason, /test:e2e:cleanup/);
});

test("an image goes by its tag, so a tag shared with something else leaves that alone", () => {
  const result = plan({ images: [image([`thunderstrux-e2e-tests:${baseline}`, "thunderstrux-e2e-tests:local"], { id: "sha256:shared" })] });
  assert.deepEqual(targets(result), [`thunderstrux-e2e-tests:${baseline}`]);
});

test("rehearsal tags that a run left behind go, for both images of the pair", () => {
  const result = plan({ images: ["one", "bad", "migration-fail"].flatMap((name) => [image([`thunderstrux-app:${rehearsal}-${name}`]), image([`thunderstrux-ops:${rehearsal}-${name}`])]) });
  assert.equal(result.remove.length, 6);
});

test("the retired :local tags go once they're old, and the tests image used by tools stays", () => {
  const result = plan({ images: [image(["thunderstrux-e2e-app:local"]), image(["thunderstrux-e2e-ops:local"]), image(["thunderstrux-e2e-tests:local"])] });
  assert.deepEqual(targets(result), ["thunderstrux-e2e-app:local", "thunderstrux-e2e-ops:local"]);
  assert.deepEqual(plan({ images: [image(["thunderstrux-e2e-app:local"], { taggedAt: recent })] }).remove, []);
});

test("untagged images go only if a run made them and no container uses them", () => {
  const untagged = image([], { project: browser, id: "sha256:orphan" });
  const used = image([], { project: browser, id: "sha256:used" });
  const stagingImage = image([], { project: staging, id: "sha256:staging" });
  const result = plan({ images: [untagged, used, stagingImage], containers: [container("thunderstrux", { status: "running", image: "sha256:used" })] });
  assert.deepEqual(targets(result), ["sha256:orphan", "sha256:staging"]);
  assert.deepEqual(untaggedRunImages([untagged, used], [container("x", { image: "sha256:orphan" })]).map((item) => item.Id), ["sha256:used"]);
});

test("nothing is ever forced or pruned, and an unknown kind is refused", () => {
  const items = [{ kind: "container", target: "a" }, { kind: "network", target: "b" }, { kind: "volume", target: "c" }, { kind: "image", target: "d" }];
  assert.deepEqual(items.map(removalArgs), [["rm", "-v", "a"], ["network", "rm", "b"], ["volume", "rm", "c"], ["image", "rm", "d"]]);
  for (const args of items.map(removalArgs)) assert.ok(!args.some((arg) => /^(?:-f|--force|prune)$/.test(arg)), args.join(" "));
  assert.throws(() => removalArgs({ kind: "system", target: "x" }), /Unknown resource kind/);
});

test("it's a dry run unless told otherwise, and a mistyped flag stops it", () => {
  assert.deepEqual(parseCleanupArgs([]), { apply: false });
  assert.deepEqual(parseCleanupArgs(["--", "--apply"]), { apply: true });
  assert.throws(() => parseCleanupArgs(["--aply"]), /Unknown option --aply/);
  assert.throws(() => parseCleanupArgs(["--force"]), /Unknown option/);
  assert.match(buildCacheCap, /^\d+GB$/);
});
