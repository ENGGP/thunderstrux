import { test, expect, login } from './fixtures';

test('mobile member can sign in and inspect an event', async ({ page, data }) => {
  await login(page, data.member.email, `/events/${data.event.id}`);
  await expect(page.getByRole('heading', {name: data.event.title, exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Buy tickets'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('mobile organiser sees events and an event workspace without sideways scrolling', async ({ page, data }) => {
  await login(page, data.owner.email, `/dashboard/events/${data.event.id}`);
  await expect(page.getByRole('navigation', { name: 'Event sections' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/dashboard/events');
  await expect(page.getByRole('link', { name: data.event.title, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
