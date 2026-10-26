import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkDocumentation, checkVault, collectReferences, defaultCoverage } from "../../scripts/check-docs.mjs";

function fixture(files, run) {
  const root = mkdtempSync(join(tmpdir(), "thunderstrux-docs-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      const destination = join(root, path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, content);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts relative Markdown links, unique wikilinks, aliases, and headings", () => {
  fixture({
    "docs/Index.md": "[[Guide|Guide alias]]\n[Guide](./Guide.md#start)",
    "docs/Guide.md": "# Start"
  }, (root) => {
    const result = checkDocumentation({ root, requiredFiles: [], sourceFiles: ["docs/Index.md"] });
    assert.deepEqual(result.errors, []);
  });
});

test("reports missing and ambiguous documentation targets", () => {
  fixture({
    "docs/Index.md": "[[Guide]]\n[Missing](./Missing.md)",
    "docs/one/Guide.md": "# One",
    "docs/two/Guide.md": "# Two"
  }, (root) => {
    const result = checkDocumentation({ root, requiredFiles: [], sourceFiles: ["docs/Index.md"] });
    assert.equal(result.errors.length, 2);
    assert.match(result.errors[0], /ambiguous wiki target 'Guide'/);
    assert.match(result.errors[1], /missing markdown target '\.\/Missing\.md'/);
  });
});

test("ignores external links, route links, headings, and code examples", () => {
  const references = collectReferences([
    "[Web](https://example.com)",
    "[Email](mailto:test@example.com)",
    "[Route](/dashboard)",
    "[Heading](#section)",
    "`[[Inline Example]]`",
    "```md",
    "[[Fenced Example]]",
    "```"
  ].join("\n"));
  assert.deepEqual(references, []);
});

test("reports missing required living documents", () => {
  fixture({ "README.md": "# Repo" }, (root) => {
    const result = checkDocumentation({ root, requiredFiles: ["AGENTS.md"], sourceFiles: ["README.md"] });
    assert.deepEqual(result.errors, ["Required documentation file is missing: AGENTS.md"]);
  });
});

test("reports malformed encoding and links that escape the repository", () => {
  fixture({
    "docs/Index.md": "[Malformed](./bad%ZZ.md)\n[Escape](../../outside.md)"
  }, (root) => {
    const result = checkDocumentation({ root, requiredFiles: [], sourceFiles: ["docs/Index.md"] });
    assert.equal(result.errors.length, 2);
    assert.match(result.errors[0], /invalid URI encoding/);
    assert.match(result.errors[1], /escapes repository root/);
  });
});

test("reports links that leave the docs/ vault and headings that don't exist", () => {
  fixture({
    "README.md": "[Docs](docs/Guide.md)",
    "docs/Index.md": "[Readme](../README.md)\n[[Guide#Start here]]\n[[Guide#Nowhere]]\n[Guide](./Guide.md#start-here)\n[Guide](./Guide.md#nowhere)\n[[#Index top]]",
    "docs/Guide.md": "# Guide\n## Start `here`",
  }, (root) => {
    const result = checkDocumentation({ root, requiredFiles: [], sourceFiles: ["README.md", "docs/Index.md"] });
    assert.equal(result.errors.length, 4);
    assert.match(result.errors[0], /missing heading '#Nowhere' in wiki target 'Guide'/);
    assert.match(result.errors[1], /missing heading '#Index top' in wiki target 'Index\.md'/);
    assert.match(result.errors[2], /leaves the Obsidian vault \(docs\/\) '\.\.\/README\.md'/);
    assert.match(result.errors[3], /missing heading '#nowhere' in markdown target '\.\/Guide\.md'/);
  });
});

test("living notes must name real code paths, tests and sources, and fit in one read", () => {
  fixture({
    "lib/real.ts": "",
    "tests/integration/real.test.ts": "",
    "docs/obsidian/Note.md": [
      "---", "sources: [lib/real.ts, lib/gone.ts]", "---",
      "`lib/real.ts:helper` `lib/gone.ts` `real.test.ts` `gone.test.ts` `lib/*.ts`"
    ].join("\n"),
    "docs/obsidian/Big.md": "x".repeat(32 * 1024 + 1),
    "docs/obsidian/History/Old.md": "`lib/removed-long-ago.ts`"
  }, (root) => {
    const result = checkVault({ root, coverage: [] });
    assert.equal(result.checkedNotes, 2);
    assert.deepEqual(result.errors.map((error) => error.replaceAll("\\", "/")), [
      "docs/obsidian/Big.md: 32769 bytes is over the 32768-byte living-note limit; split it",
      "docs/obsidian/Note.md: frontmatter source does not exist 'lib/gone.ts'",
      "docs/obsidian/Note.md: code path does not exist 'lib/gone.ts'",
      "docs/obsidian/Note.md: test file does not exist 'gone.test.ts'"
    ]);
  });
});

test("coverage needs each code item named in backticks in its owning note", () => {
  fixture({
    "app/page.tsx": "",
    "app/(public)/events/[eventId]/page.tsx": "",
    "app/api/events/route.ts": "",
    "app/api/events/[eventId]/publish/route.ts": "",
    "docs/obsidian/Frontend and Backend Flow.md": "`/` and `/events/[eventId]`",
    "docs/obsidian/API Reference.md": "`PATCH /api/events/[eventId]/publish`",
    "docs/obsidian/API Reference Public.md": "`GET/POST /api/events?orgId=...`",
    "docs/obsidian/Route Security Inventory.md": "`/api/events/` only"
  }, (root) => {
    const coverage = defaultCoverage.filter((rule) => rule.what === "API route" || rule.what === "page route");
    assert.deepEqual(checkVault({ root, coverage }).errors, [
      "Route Security Inventory: undocumented API route `/api/events/[eventId]/publish`"
    ]);
  });
});

test("coverage counts scripts by name and reports an unreadable source", () => {
  fixture({
    "scripts/worker.mjs": "",
    "scripts/worker.ts": "",
    "scripts/restore.sql": "",
    "package.json": JSON.stringify({ scripts: { "docs:check": "node x", dev: "next dev" } }),
    "docs/obsidian/Ops.md": "`node scripts/worker.ts` and `pnpm docs:check -- --flag`"
  }, (root) => {
    const coverage = [
      ...defaultCoverage.filter((rule) => rule.what === "script file" || rule.what === "package script"),
      { what: "alert", notes: ["Ops"], items: () => { throw new Error("no alerts file"); } }
    ];
    assert.deepEqual(checkVault({ root, coverage }).errors, [
      "any living note: undocumented package script `dev`",
      "any living note: undocumented script file `scripts/restore`",
      "coverage of alert: cannot read its source (no alerts file)"
    ]);
  });
});
