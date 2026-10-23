import { test, expect, prisma, login } from "./fixtures";
import { formatDay } from "@/components/calendar/layout";
import { localToday } from "@/lib/analytics/range";
import { formatDayInput } from "@/lib/date-input";

// T33: the owner opens Calendar from the sidebar, finds today's event in the
// month and the week, starts a new event on a day, and gets the agenda on a phone.
test("an owner reads the calendar by month, week and agenda and starts an event on a day", async ({ page, data }) => {
  const today = localToday("Australia/Brisbane");
  // 6 pm to 9 pm today in Brisbane (UTC+10, no daylight saving).
  await prisma.event.update({ where: { id: data.event.id }, data: { title: "Engineering Mixer", startTime: new Date(`${today}T08:00:00Z`), endTime: new Date(`${today}T11:00:00Z`) } });
  await login(page, data.owner.email, "/dashboard");
  await page.getByRole("link", { name: "Calendar", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  await expect(page.getByText("Brisbane time (AEST)")).toBeVisible();
  const chip = page.getByRole("link", { name: /^Engineering Mixer, / }).first();
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("6:00 pm");

  await page.getByRole("navigation", { name: "Calendar view" }).getByRole("link", { name: "Week" }).click();
  await expect(page).toHaveURL(/view=week/);
  await expect(page.getByRole("link", { name: /^Engineering Mixer, / }).first()).toContainText("6:00 pm to 9:00 pm");
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.screenshot({ path: "test-results/calendar-week-1280.png", fullPage: true });

  await page.getByRole("navigation", { name: "Calendar view" }).getByRole("link", { name: "Month" }).click();
  await expect(page).not.toHaveURL(/view=/);
  await expect(page.getByRole("link", { name: /^Engineering Mixer, / }).first()).toContainText("6:00 pm Engineering Mixer");
  await page.screenshot({ path: "test-results/calendar-month-1280.png", fullPage: true });
  await page.getByRole("link", { name: `New event on ${formatDay(today, true)}` }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/dashboard/events/new\\?date=${today}`));
  const starts = page.getByRole("group", { name: "Starts", exact: true });
  await expect(starts.getByLabel("Date", { exact: true })).toHaveValue(formatDayInput(today));
  await expect(starts.getByLabel("Time")).toHaveValue("18:00");

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/dashboard/calendar");
  await expect(page.getByRole("heading", { name: `Today · ${formatDay(today)}` })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Calendar view" })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/calendar-agenda-390.png", fullPage: true });
});

// An event past midnight shows where it starts (design round C1): a workshop
// from Wednesday 1:00 am to Thursday 3:00 am sits on Wednesday only, in the
// month and in Wednesday's time grid from 1 am, never spilling onto Thursday.
test("an overnight event stays on the day it starts in the month and in the week's time grid", async ({ page, data }) => {
  const today = localToday("Australia/Brisbane");
  const noon = (day: string) => new Date(`${day}T12:00:00Z`);
  const plusDays = (day: string, count: number) => new Date(noon(day).getTime() + count * 86_400_000).toISOString().slice(0, 10);
  // The Wednesday at least a week away, so it is in the future and a full week shows.
  let wednesday = plusDays(today, 7);
  while (noon(wednesday).getUTCDay() !== 3) wednesday = plusDays(wednesday, 1);
  const thursday = plusDays(wednesday, 1);
  // 1:00 am Wednesday to 3:00 am Thursday in Brisbane (UTC+10).
  await prisma.event.update({ where: { id: data.event.id }, data: { title: "Overnight Draft Workshop", status: "draft", startTime: new Date(`${plusDays(wednesday, -1)}T15:00:00Z`), endTime: new Date(`${wednesday}T17:00:00Z`), salesCloseAt: new Date(`${plusDays(wednesday, -1)}T15:00:00Z`) } });
  await login(page, data.owner.email, `/dashboard/calendar?date=${wednesday}`);
  await page.setViewportSize({ width: 1280, height: 1000 });

  const chip = page.getByRole("link", { name: /^Overnight Draft Workshop, / }).first();
  await expect(chip).toContainText("1:00 am Overnight Draft Workshop");
  // One column: Wednesday's, never Thursday's.
  expect(await chip.evaluate((element) => (element as HTMLElement).style.gridColumn)).toBe("3 / span 1");
  await page.screenshot({ path: "test-results/calendar-overnight-month-1280.png", fullPage: true });

  await page.goto(`/dashboard/calendar?view=week&date=${wednesday}`);
  await expect(page.getByText("All day")).toHaveCount(0);
  const block = page.getByRole("link", { name: /^Overnight Draft Workshop, / }).first();
  await expect(block).toContainText("1:00 am to 3:00 am Thu");
  // In Wednesday's column (the third day), and its top sits at the 1 am line.
  const [blockBox, tuesdayHeader, thursdayHeader] = await Promise.all([
    block.boundingBox(),
    page.getByLabel(formatDay(plusDays(wednesday, -1), true), { exact: true }).boundingBox(),
    page.getByLabel(formatDay(thursday, true), { exact: true }).boundingBox()
  ]);
  // Day numbers sit centred in their columns, so Wednesday's column lies between Tuesday's and Thursday's.
  expect(blockBox!.x).toBeGreaterThan(tuesdayHeader!.x + tuesdayHeader!.width);
  expect(blockBox!.x + blockBox!.width).toBeLessThan(thursdayHeader!.x);
  await page.screenshot({ path: "test-results/calendar-overnight-week-1280.png", fullPage: true });
});
