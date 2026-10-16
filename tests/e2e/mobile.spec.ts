import { test, expect, login, prisma } from './fixtures';

test('mobile member can sign in and inspect an event', async ({ page, data }) => {
  // Paid tickets are only offered once the society can take payments (T15a).
  await prisma.organisation.update({ where: { id: data.organisation.id }, data: { stripeAccountId: 'acct_e2e_mobile', stripeChargesEnabled: true } });
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
