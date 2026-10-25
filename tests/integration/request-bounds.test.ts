import { describe, expect, test } from "vitest";
import { z } from "zod";
import { parseJsonBody, validateInput } from "@/lib/api/request";

const streamed = (text: string) => new Request("http://localhost", { method: "POST", body: new Blob([text]).stream(), duplex: "half" } as RequestInit);

describe("request bounds", () => {
  test("JSON bodies over 100 KB are refused without being parsed", async () => {
    const oversized = JSON.stringify({ value: "x".repeat(100_000) });
    // Declared too large, and streamed with no length at all.
    for (const request of [new Request("http://localhost", { method: "POST", body: oversized, headers: { "content-length": String(oversized.length) } }), streamed(oversized)]) {
      expect(await parseJsonBody(request)).toEqual({ success: false, details: [{ message: "Request body is too large" }] });
    }
    expect(await parseJsonBody(streamed(JSON.stringify({ value: "x".repeat(90_000) })))).toMatchObject({ success: true });
    expect(await parseJsonBody(new Request("http://localhost", { method: "POST", body: "{" }))).toEqual({ success: false, details: [{ message: "Request body must be valid JSON" }] });
  });

  test("validation answers list at most 20 issues", () => {
    const schema = z.object(Object.fromEntries(Array.from({ length: 30 }, (_item, index) => [`field${index}`, z.string()])));
    const result = validateInput({}, schema);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.details).toHaveLength(20);
  });
});
