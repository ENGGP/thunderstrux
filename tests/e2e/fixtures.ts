import { test as base, expect, type Locator, type Page, type Request } from '@playwright/test';
import { createClient } from '@redis/client';
import { prisma } from '@/lib/db';
import { createEvent, createMember, createOrganisationAccount, createOrganisationStaff } from '@/tests/helpers/test-data';

if (process.env.DATABASE_URL !== 'postgresql://e2e:e2e-disposable-only@db:5432/thunderstrux_e2e_test') {
  throw new Error('E2E fixtures require the isolated Compose database');
}

export async function seed() {
  const { user: owner, organisation } = await createOrganisationAccount();
  const member = await createMember();
  const manager = await createMember();
  const staff = await createOrganisationStaff({ organisationId: organisation.id, userId: manager.id });
  const event = await createEvent({ organisationId: organisation.id, status: 'published' });
  return { owner, organisation, member, manager, staff, event, ticket: event.ticketTypes[0] };
}

// Every test signs in from the same address, so the per-address sign-in budget
// (login_ip_global) would make a long run lock out its last tests. Each test
// starts with a fresh budget; per-email limits and the limit itself are untouched.
async function resetSharedLoginBudget() {
  const client = createClient({ url: process.env.INTEGRATION_REDIS_URL });
  await client.connect();
  try {
    const keys = await client.keys('thunderstrux:rate-limit:login_ip_global:*');
    if (keys.length) await client.del(keys);
  } finally {
    await client.quit();
  }
}

export const test = base.extend<{ data: Awaited<ReturnType<typeof seed>>; appErrors: void }>({
  data: async ({}, use) => { await resetSharedLoginBudget(); await use(await seed()); },
  appErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    // A resource the security policy blocks (T39) fails the test that loaded it.
    page.on('console', message => { if (message.type() === 'error' && /Content Security Policy|Refused to (load|execute|connect|frame|apply)/.test(message.text())) errors.push(message.text()); });
    await use();
    expect(errors, 'Unexpected browser exceptions').toEqual([]);
  }, { auto: true }]
});

export async function login(page: Page, email: string, callback = '/dashboard') {
  await page.goto(`/login?callbackUrl=${encodeURIComponent(callback)}`);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(`http://localhost:3100${callback}`);
}

export { expect, prisma, createEvent, createMember, createOrganisationAccount, createOrganisationStaff };

// A fast double click can submit twice before React disables the button. Two
// submits in one tick must send one request.
export async function submitTwice(page: Page, form: Locator, path: string) {
  const posted = (request: Request) => request.method() === 'POST' && new URL(request.url()).pathname === path;
  let sent = 0;
  const count = (request: Request) => { if (posted(request)) sent += 1; };
  page.on('request', count);
  await Promise.all([
    page.waitForResponse((response) => posted(response.request())),
    form.evaluate((element: HTMLFormElement) => { element.requestSubmit(); element.requestSubmit(); })
  ]);
  page.off('request', count);
  expect(sent).toBe(1);
}

export async function selectStaffContext(page: Page, organisationId: string) {
  const { token } = await (await page.request.get('/api/security/csrf')).json();
  const response = await page.request.post('/api/me/context', { headers: { Origin: 'http://localhost:3100', 'x-thunderstrux-csrf-token': token }, data: { mode: 'staff', organisationId } });
  expect(response.status()).toBe(200);
  await page.goto('/dashboard');
}
