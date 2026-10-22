import { describe, expect, test } from "vitest";
import { formatDayInput, monthWeeks, parseDayInput, shiftDay, shiftMonth } from "@/lib/date-input";

describe("house date picker days", () => {
  test("reads the ways people type a day, and refuses days that don't exist", () => {
    for (const text of ["2026-10-22", "22/10/2026", "22-10-2026", "22.10.2026", "22 Oct 2026", "Thu 22 October 2026", " 22  oct, 2026 "]) expect(parseDayInput(text)).toBe("2026-10-22");
    expect(parseDayInput("1/1/2027")).toBe("2027-01-01");
    expect(parseDayInput("")).toBe("");
    for (const text of ["31/02/2026", "2026-13-01", "22 Smarch 2026", "next week", "10/22"]) expect(parseDayInput(text)).toBeNull();
    expect(formatDayInput("2026-06-05")).toBe("5 Jun 2026");
    expect(formatDayInput("")).toBe("");
  });

  test("moves by day and month, holding to a month's last day, in Monday-first weeks", () => {
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftMonth("2026-03-15", -12)).toBe("2025-03-15");
    const october = monthWeeks("2026-10-22");
    expect(october[0][0]).toBe("2026-09-28");
    expect(october.at(-1)?.at(-1)).toBe("2026-11-01");
    expect(october.every((week) => week.length === 7)).toBe(true);
    expect(monthWeeks("2027-02-10")).toHaveLength(4);
  });
});
