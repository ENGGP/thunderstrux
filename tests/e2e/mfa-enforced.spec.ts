import { test, expect, login, prisma, selectStaffContext } from './fixtures';
import { totpCode } from '@/lib/security/staff-mfa';
import { decode, encode } from 'next-auth/jwt';

test('enforced staff MFA survives session refresh and denies a new password-only session', async ({ page, browser, data }) => {
  await login(page, data.manager.email, '/mfa');
  const { token: contextToken } = await (await page.request.get('/api/security/csrf')).json();
  expect((await page.request.post('/api/me/context', { headers: { Origin: 'http://localhost:3100', 'x-thunderstrux-csrf-token': contextToken }, data: { mode: 'staff', organisationId: data.organisation.id } })).status()).toBe(403);
  await page.goto('/mfa?callbackUrl=/dashboard');
  expect((await page.request.get(`/api/events?orgId=${data.organisation.id}`)).status()).toBe(403);

  await page.getByRole('button', { name: 'Set up authenticator' }).click();
  const secret = await page.locator('code').textContent();
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByLabel('Authenticator code').fill(totpCode(secret!, Math.floor(Date.now() / 30_000)));
  await page.getByRole('button', { name: 'Confirm setup' }).click();
  await expect(page.getByRole('heading', { name: 'Save these recovery codes' })).toBeVisible();
  await expect(page.locator('main li')).toHaveCount(10);
  await page.getByRole('button', { name: 'I saved my codes' }).click();
  await expect(page).toHaveURL('http://localhost:3100/dashboard');
  await selectStaffContext(page, data.organisation.id);
  await page.goto('/dashboard/events');
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
    await secondPage.goto('/mfa?callbackUrl=/dashboard');
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

  await page.goto('/mfa?callbackUrl=/dashboard');
  await expect(page.getByRole('button', { name: 'Sign out and sign in again' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out and sign in again' }).click();
  await expect(page).toHaveURL(/\/login\?callbackUrl=/);
});


test('committee handover with enforced MFA retires legacy ownership and removes the outgoing live session', async ({ page, browser, data }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:3100' });
  async function enroll(targetPage: typeof page, email: string) {
    await login(targetPage, email, '/mfa');
    await targetPage.goto('/mfa?callbackUrl=/dashboard');
    await targetPage.getByRole('button', { name: 'Set up authenticator' }).click();
    const secret = await targetPage.locator('code').textContent(); expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await targetPage.getByLabel('Authenticator code').fill(totpCode(secret!, Math.floor(Date.now() / 30000)));
    await targetPage.getByRole('button', { name: 'Confirm setup' }).click();
    await expect(targetPage.getByRole('heading', { name: 'Save these recovery codes' })).toBeVisible();
    await targetPage.getByRole('button', { name: 'I saved my codes' }).click();
    await expect(targetPage).toHaveURL('http://localhost:3100/dashboard');
    await selectStaffContext(targetPage, data.organisation.id);
  }
  try {
    const incoming = await context.newPage(); await enroll(incoming, data.manager.email);
    await login(page, data.owner.email, '/mfa');
    const { token } = await (await page.request.get('/api/security/csrf')).json();
    expect((await page.request.post(`/api/orgs/${data.organisation.slug}/staff/handover`, { headers: { Origin: 'http://localhost:3100', 'x-thunderstrux-csrf-token': token }, data: { incomingStaffId: data.staff.id, outgoingAccess: 'revoked', currentPassword: 'password123', acknowledgement: 'HAND OVER OWNERSHIP' } })).status()).toBe(403);
    await page.getByRole('button', { name: 'Set up authenticator' }).click();
    const secret = await page.locator('code').textContent();
    await page.getByLabel('Authenticator code').fill(totpCode(secret!, Math.floor(Date.now() / 30000)));
    await page.getByRole('button', { name: 'Confirm setup' }).click();
    await expect(page.getByRole('heading', { name: 'Save these recovery codes' })).toBeVisible();
    await page.getByRole('button', { name: 'I saved my codes' }).click();
    await expect(page).toHaveURL('http://localhost:3100/dashboard');
    await page.goto('/dashboard/settings/staff');
    await page.getByLabel('Incoming owner', { exact: true }).selectOption(data.staff.id);
    await page.getByLabel('Your access after handover', { exact: true }).selectOption('revoked');
    await expect(page.locator('main').getByRole('status')).toContainText(data.manager.email);
    await page.getByLabel('Current password for handover').fill('password123');
    await page.getByLabel('Type HAND OVER OWNERSHIP to confirm').fill('HAND OVER OWNERSHIP');
    const result = page.waitForResponse(response => response.url().endsWith('/staff/handover') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Hand over ownership', exact: true }).click(); expect((await result).status()).toBe(200);
    await expect(page).toHaveURL(/\/dashboard(\/create)?$/);
    expect((await page.request.get(`/api/orgs/${data.organisation.slug}/staff`)).status()).toBe(403);
    expect((await prisma.organisation.findUniqueOrThrow({ where: { id: data.organisation.id } })).accountUserId).toBeNull();
    await incoming.goto('/dashboard/settings/staff');
    await expect(incoming.getByRole('heading', { name: 'Committee handover' })).toBeVisible();
    expect(await prisma.organisationStaff.findUniqueOrThrow({ where: { id: data.staff.id } })).toMatchObject({ role: 'owner', status: 'active' });
    expect(await prisma.auditLog.count({ where: { organisationId: data.organisation.id, action: 'staff.ownership.handed_over' } })).toBe(1);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: data.event.id } })).organisationId).toBe(data.organisation.id);
  } finally { await context.close(); }
});
