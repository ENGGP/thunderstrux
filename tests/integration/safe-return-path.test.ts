import { describe, expect, test } from "vitest";
import { safeReturnPath } from "@/lib/security/safe-return-path";

describe("safe internal return paths", () => {
  test("keeps internal path and rejects external or browser-normalized slash variants", () => {
    expect(safeReturnPath("/dashboard/orders?status=paid#top"))
      .toBe("/dashboard/orders?status=paid#top");
    for (const value of ["https://evil.example", "//evil.example", "/\\evil.example",
      "/%5cevil.example", "/%2fevil.example", "\\evil.example"]) {
      expect(safeReturnPath(value)).toBe("/dashboard");
    }
  });
});
