import { test, expect, login } from './fixtures';

test('mobile member can sign in and inspect an event', async ({ page, data }) => {
  await login(page, data.member.email, `/events/${data.event.id}`);
  await expect(page.getByRole('heading', {name: data.event.title, exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Buy Ticket'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
