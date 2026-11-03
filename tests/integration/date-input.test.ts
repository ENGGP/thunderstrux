import { describe, expect, test } from "vitest";
import { endAfterStart, formatDayInput, monthWeeks, parseDayInput, shiftDay, shiftMonth } from "@/lib/date-input";

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

  test("fills the event's end from its start, and never leaves it before the start", () => {
    // Empty end: two hours after the start, across midnight too.
    expect(endAfterStart("2026-11-20T18:00", "", "", true)).toBe("2026-11-20T20:00");
    expect(endAfterStart("2026-12-31T23:00", "", "", false)).toBe("2027-01-01T01:00");
    // A filled-in end keeps its length as the start moves, even later in the day.
    expect(endAfterStart("2026-11-21T19:00", "2026-11-20T18:00", "2026-11-20T21:00", true)).toBe("2026-11-21T22:00");
    // An end the organiser chose stays while it is still after the start.
    expect(endAfterStart("2026-11-20T19:00", "2026-11-20T18:00", "2026-11-20T23:30", false)).toBe("2026-11-20T23:30");
    // ...and moves, keeping its length, once the start passes it.
    expect(endAfterStart("2026-11-22T18:00", "2026-11-20T18:00", "2026-11-20T21:00", false)).toBe("2026-11-22T21:00");
    expect(endAfterStart("2026-11-20T21:00", "", "2026-11-20T21:00", false)).toBe("2026-11-20T23:00");
    // No start yet, or the start cleared: the end is left alone.
    expect(endAfterStart("", "2026-11-20T18:00", "2026-11-20T20:00", true)).toBe("2026-11-20T20:00");
  });
});
