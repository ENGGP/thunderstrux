import { describe, expect, test } from "vitest";
import { formatMoneyInput, parseMoneyInput } from "@/lib/format";
import { toZonedInput, zoneLabel, zonedCandidates } from "@/lib/zoned-time";

describe("society wall-clock times", () => {
  test("round-trips an ordinary time in a zone without daylight saving", () => {
    const [start] = zonedCandidates("2026-10-23T18:00", "Australia/Brisbane");
    expect(start.toISOString()).toBe("2026-10-23T08:00:00.000Z");
    expect(toZonedInput(start, "Australia/Brisbane")).toBe("2026-10-23T18:00");
    expect(zoneLabel("Australia/Brisbane", start)).toBe("Brisbane time (AEST, UTC+10)");
  });

  test("finds no instant inside the spring-forward gap", () => {
    expect(zonedCandidates("2026-10-04T02:30", "Australia/Sydney")).toEqual([]);
    expect(zonedCandidates("2026-10-04T03:00", "Australia/Sydney").map((d) => d.toISOString())).toEqual([
      "2026-10-03T16:00:00.000Z"
    ]);
  });

  test("finds both instants inside the fall-back overlap, earliest first", () => {
    expect(zonedCandidates("2027-04-04T02:30", "Australia/Sydney").map((d) => d.toISOString())).toEqual([
      "2027-04-03T15:30:00.000Z",
      "2027-04-03T16:30:00.000Z"
    ]);
  });

  test("rejects values that are not a datetime-local minute", () => {
    expect(zonedCandidates("", "Australia/Brisbane")).toEqual([]);
    expect(zonedCandidates("2026-02-30T10:00", "Australia/Brisbane")).toEqual([]);
  });
});

describe("price inputs", () => {
  test("parses dollars to cents without floating point", () => {
    expect(parseMoneyInput("15")).toBe(1500);
    expect(parseMoneyInput("$15.5")).toBe(1550);
    expect(parseMoneyInput(" 0.07 ")).toBe(7);
    expect(parseMoneyInput("19.99")).toBe(1999);
    expect(parseMoneyInput("0")).toBe(0);
  });

  test("rejects anything that is not a price", () => {
    for (const value of ["", "-1", "1.234", "abc", "1e3", "15.", "1,000"]) {
      expect(parseMoneyInput(value)).toBeNull();
    }
  });

  test("formats cents for the input", () => {
    expect(formatMoneyInput(1500)).toBe("15.00");
    expect(formatMoneyInput(7)).toBe("0.07");
  });
});
