import { test as base, expect, type Page } from '@playwright/test';
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

export const test = base.extend<{ data: Awaited<ReturnType<typeof seed>>; appErrors: void }>({
  data: async ({}, use) => { await use(await seed()); },
  appErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
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
