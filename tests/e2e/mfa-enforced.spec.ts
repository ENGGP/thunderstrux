import { test, expect, login, prisma } from './fixtures';
import { totpCode } from '@/lib/security/staff-mfa';
import { decode, encode } from 'next-auth/jwt';

test('enforced staff MFA survives session refresh and denies a new password-only session', async ({ page, browser, data }) => {
  await login(page, data.manager.email, '/mfa');
  await page.goto('/dashboard/events');
  await expect(page).toHaveURL(/\/mfa\?callbackUrl=/);
  expect((await page.request.get(`/api/events?orgId=${data.organisation.id}`)).status()).toBe(403);

  await page.getByRole('button', { name: 'Set up authenticator' }).click();
  const secret = await page.locator('code').textContent();
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByLabel('Authenticator code').fill(totpCode(secret!, Math.floor(Date.now() / 30_000)));
  await page.getByRole('button', { name: 'Confirm setup' }).click();
  await expect(page.getByRole('heading', { name: 'Save these recovery codes' })).toBeVisible();
  await expect(page.locator('main li')).toHaveCount(10);
  await page.getByRole('button', { name: 'I saved my codes' }).click();
  await expect(page).toHaveURL('http://localhost:3100/dashboard/events');
  expect((await page.request.get(`/api/events?orgId=${data.organisation.id}`)).status()).toBe(200);

  await page.evaluate(async () => { await fetch('/api/auth/session', { cache: 'no-store' }); });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
  const { token } = await (await page.request.get('/api/security/csrf')).json();
  const response = await page.request.post('/api/events', {
    headers: { Origin: 'http://localhost:3100', 'x-thunderstrux-csrf-token': token },
    data: { organisationId: data.organisation.id, title: 'MFA approved event',
      description: 'Verified staff action', location: 'Campus',
      startTime: data.event.startTime.toISOString(), endTime: data.event.endTime.toISOString(),
      status: 'draft', ticketTypes: [] }
  });
  expect(response.status()).toBe(201);
  expect(await prisma.event.count({ where: { organisationId: data.organisation.id,
    title: 'MFA approved event' } })).toBe(1);

  const secondContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  try {
    const secondPage = await secondContext.newPage();
    await login(secondPage, data.manager.email, '/mfa');
    await secondPage.goto('/dashboard/events');
    await expect(secondPage).toHaveURL(/\/mfa\?callbackUrl=/);
    expect((await secondPage.request.get(`/api/events?orgId=${data.organisation.id}`)).status()).toBe(403);
  } finally {
    await secondContext.close();
  }
});

test('pre-rollout staff session asks for a fresh password sign-in', async ({ page, data }) => {
  await login(page, data.manager.email, '/mfa');
  const cookie = (await page.context().cookies()).find((entry) => entry.name.endsWith('authjs.session-token'));
  expect(cookie).toBeDefined();
  const secret = process.env.AUTH_SECRET!;
  const oldToken = await decode({ token: cookie!.value, secret, salt: cookie!.name });
  expect(oldToken).not.toBeNull();
  delete oldToken!.staffMfaSessionId;
  const oldCookie = await encode({ token: oldToken!, secret, salt: cookie!.name });
  await page.context().addCookies([{ ...cookie!, value: oldCookie }]);

  await page.goto('/dashboard/events');
  await expect(page).toHaveURL(/\/mfa\?callbackUrl=/);
  await expect(page.getByRole('button', { name: 'Sign out and sign in again' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out and sign in again' }).click();
  await expect(page).toHaveURL(/\/login\?callbackUrl=/);
});
