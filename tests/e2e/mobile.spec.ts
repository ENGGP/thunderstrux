import { test, expect, login, prisma } from './fixtures';

test('mobile member can sign in and inspect an event', async ({ page, data }) => {
  // Paid tickets are only offered once the society can take payments (T15a).
  await prisma.organisation.update({ where: { id: data.organisation.id }, data: { stripeAccountId: `acct_e2e_mobile_${data.organisation.id}`, stripeChargesEnabled: true } });
  await login(page, data.member.email, `/events/${data.event.id}`);
  await expect(page.getByRole('heading', {name: data.event.title, exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Buy tickets'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('phone buy bar shows only while the ticket box button is below the screen', async ({ page, data }) => {
  await prisma.organisation.update({ where: { id: data.organisation.id }, data: { stripeAccountId: `acct_e2e_mobile_${data.organisation.id}`, stripeChargesEnabled: true } });
  await page.setViewportSize({ width: 412, height: 420 });
  await login(page, data.member.email, `/events/${data.event.id}`);
  const buy = page.getByRole('button', { name: 'Buy tickets' });
  await page.evaluate(() => window.scrollTo(0, 0));
  // The box's button is below the screen, so the bar repeats it.
  await expect(buy).toHaveCount(2);
  await buy.first().scrollIntoViewIfNeeded();
  // Slid away and inert: the bar's copy leaves the accessibility tree.
  await expect(buy).toHaveCount(1);
});

test('mobile organiser sees events and an event workspace without sideways scrolling', async ({ page, data }) => {
  await login(page, data.owner.email, `/dashboard/events/${data.event.id}`);
  await expect(page.getByRole('navigation', { name: 'Event sections' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/dashboard/events');
  await expect(page.getByRole('link', { name: data.event.title, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
