import { test, expect, login, prisma } from './fixtures';

test('mobile member can sign in and inspect an event', async ({ page, data }) => {
  // Paid tickets are only offered once the society can take payments (T15a).
  await prisma.organisation.update({ where: { id: data.organisation.id }, data: { stripeAccountId: `acct_e2e_mobile_${data.organisation.id}`, stripeChargesEnabled: true } });
  await login(page, data.member.email, `/events/${data.event.id}`);
  await expect(page.getByRole('heading', {name: data.event.title, exact: true})).toBeVisible();
  // The box's own button; while it is below the screen the phone bar repeats it (next test).
  await expect(page.getByRole('button', {name: 'Get tickets', exact: true}).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('phone buy bar shows only while the ticket box button is below the screen', async ({ page, data }) => {
  await prisma.organisation.update({ where: { id: data.organisation.id }, data: { stripeAccountId: `acct_e2e_mobile_${data.organisation.id}`, stripeChargesEnabled: true } });
  await page.setViewportSize({ width: 412, height: 420 });
  await login(page, data.member.email, `/events/${data.event.id}`);
  const buy = page.getByRole('button', { name: 'Get tickets', exact: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  // The box's button is below the screen, so the bar repeats it.
  await expect(buy).toHaveCount(2);
  await buy.first().scrollIntoViewIfNeeded();
  // Slid away and inert: the bar's copy leaves the accessibility tree.
  await expect(buy).toHaveCount(1);
});

// The checkout's Pay sits below its summary cards on a phone, so a bar repeats it until the button is in view.
test('phone pay bar shows only while the checkout Pay button is below the screen', async ({ page, data }) => {
  await prisma.organisation.update({ where: { id: data.organisation.id }, data: { stripeAccountId: `acct_e2e_mobile_${data.organisation.id}`, stripeChargesEnabled: true } });
  await page.setViewportSize({ width: 412, height: 420 });
  await login(page, data.member.email, `/events/${data.event.id}/checkout?ticketTypeId=${data.ticket.id}&quantity=1`);
  const pay = page.getByRole('button', { name: /^(Pay A\$|Confirm free registration)/ });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(pay).toHaveCount(2);
  await pay.first().scrollIntoViewIfNeeded();
  await expect(pay).toHaveCount(1);
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
