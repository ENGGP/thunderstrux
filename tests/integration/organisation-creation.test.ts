import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { createUser, unique } from "@/tests/helpers/test-data";

// Organisation's logo and cover relations include its own id (see the schema), so a create
// whose data names no relation column makes Prisma skip generating the id (P2011). This
// broke `pnpm test:smoke` from T08 until this guard.

describe("organisation creation", () => {
  test("a create naming a relation column gets an id; one naming none is refused (canary for the Prisma behaviour)", async () => {
    const owner = await createUser({ email: `${unique("org-owner")}@example.com`, accountRole: "organisation" });
    for (const data of [
      { name: "Linked", slug: unique("org-linked"), accountUserId: owner.id },
      { name: "Unlinked", slug: unique("org-unlinked"), accountUserId: null }
    ]) {
      expect((await prisma.organisation.create({ data, select: { id: true } })).id).toEqual(expect.any(String));
    }
    // If a Prisma upgrade starts generating the id here, this fails: drop the workaround and this guard.
    await expect(prisma.organisation.create({ data: { name: "Bare", slug: unique("org-bare") } })).rejects.toMatchObject({ code: "P2011" });
  });

  test("every organisation create or upsert in the codebase names accountUserId or an id", () => {
    const roots = ["app", "lib", "scripts", "prisma", "tests/helpers"];
    const files = roots.flatMap(function walk(dir: string): string[] {
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(full);
        return /\.(ts|tsx|mjs|js)$/.test(entry.name) ? [full] : [];
      });
    });

    // The text of the balanced {...} that follows `key:` from `from` onwards.
    const objectAfter = (source: string, from: number, key: string) => {
      const at = source.indexOf(`${key}:`, from);
      const open = at < 0 ? -1 : source.indexOf("{", at);
      if (open < 0) return null;
      let depth = 0;
      for (let i = open; i < source.length; i += 1) {
        if (source[i] === "{") depth += 1;
        else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
      }
      return null;
    };
    // `id: …` or shorthand `{ id, … }` both count.
    const safe = (data: string | null) => data !== null && /\baccountUserId\b|(^|[{,\s])id\s*[:,}]/.test(data);

    const calls: string[] = [];
    const unsafe: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(/\.organisation\.(create|upsert)\(/g)) {
        const where = `${file}:${source.slice(0, match.index).split("\n").length}`;
        calls.push(where);
        const data = objectAfter(source, match.index, match[1] === "upsert" ? "create" : "data");
        if (!safe(data)) unsafe.push(where);
      }
    }
    expect(calls.length).toBeGreaterThan(0);
    expect(unsafe).toEqual([]);
  });
});
