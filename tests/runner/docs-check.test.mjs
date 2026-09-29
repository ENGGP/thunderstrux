import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkDocumentation, collectReferences } from "../../scripts/check-docs.mjs";

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
