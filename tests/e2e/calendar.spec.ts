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
