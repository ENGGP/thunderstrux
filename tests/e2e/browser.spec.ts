import { test, expect, prisma, login, createEvent, createOrganisationAccount, createMember, createOrganisationStaff } from './fixtures';

test('signup, duplicate email, incorrect password, logout and protected callback', async ({ page, data }) => {
  await page.goto(`/events/${data.event.id}`);
  await expect(page).toHaveURL(/\/login\?callbackUrl=/);
  await page.getByRole('link', { name: "Don't have an account? Sign up" }).click();
  await expect(page).toHaveURL(/\/signup\?callbackUrl=/);
  const email = `signup-${Date.now()}@example.com`;
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByLabel('First name').fill('Browser');
  await page.getByLabel('Last name').fill('Member');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(`http://localhost:3100/events/${data.event.id}`);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:3100/');
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?/);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Invalid email or password.')).toBeVisible();
  await page.goto('/signup');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText('Use a different email or sign in')).toBeVisible();
});

test('external callback remains on app origin', async ({ page, data }) => {
  await page.goto('/login?callbackUrl=https%3A%2F%2Fexample.com');
  await page.getByLabel('Email', { exact: true }).fill(data.member.email);
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:3100/dashboard');
});

test('published discovery, draft isolation, pagination and sold-out tickets', async ({ page, data }) => {
  const draft = await createEvent({ organisationId: data.organisation.id });
  const soldout = await createEvent({ organisationId: data.organisation.id, status: 'published', ticketTypes: [{name: 'Sold Out', price: 1200, quantity: 0}] });
  await page.goto('/?limit=1');
  await expect(page.getByRole('heading', { name: 'Discover Events' })).toBeVisible();
  const response = await page.request.get('/api/public/events?limit=1');
  const first = await response.json();
  expect(first.events).toHaveLength(1);
  expect(first.pageInfo.hasNextPage).toBe(true);
  const second = await (await page.request.get(`/api/public/events?limit=1&cursor=${encodeURIComponent(first.pageInfo.nextCursor)}`)).json();
  expect(second.events[0].id).not.toBe(first.events[0].id);
  expect((await page.request.get(`/api/public/events/${draft.id}`)).status()).toBe(404);
  await login(page, data.member.email, `/events/${soldout.id}`);
  await expect(page.getByRole('button', { name: 'Sold out' })).toBeDisabled();
  await page.goto(`/events/${draft.id}`);
  await expect(page.getByText('This page could not be found.')).toBeVisible();
});

test('checkout validates quantities, readiness, origin and absent provider configuration', async ({ page, data }) => {
  await login(page, data.member.email, `/events/${data.event.id}`);
  await page.getByLabel('Quantity').fill('0');
  await expect(page.getByRole('button', { name: 'Buy Ticket' })).toBeDisabled();
  await page.getByLabel('Quantity').fill('1');
  await page.getByRole('button', { name: 'Buy Ticket' }).click();
  await expect(page.getByText('Event organiser must complete Stripe onboarding before accepting payments')).toBeVisible();
  const body = { eventId: data.event.id, ticketTypeId: data.ticket.id, quantity: 1 };
  expect((await page.request.post('/api/payments/checkout/event', { headers: { Origin: 'https://example.com' }, data: body })).status()).toBe(403);
  await prisma.organisation.update({ where: {id: data.organisation.id}, data: {stripeAccountId: 'acct_synthetic', stripeChargesEnabled: true} });
  expect((await page.request.post('/api/payments/checkout/event', {headers: { Origin: 'http://localhost:3100' }, data: body})).status()).toBe(503);
  expect(await prisma.order.count({where: {eventId: data.event.id}})).toBe(0);
});

test('joined members including staff-looking join roles cannot manage', async ({ page, data }) => {
  await prisma.organisationMember.create({data: {userId: data.member.id, organisationId: data.organisation.id, role: 'org_owner'}});
  await login(page, data.member.email);
  for (const path of ['/dashboard/events', '/dashboard/orders', '/dashboard/settings', '/dashboard/settings/staff']) {
    await page.goto(path);
    await expect(page.getByText('This page could not be found.')).toBeVisible();
  }
  expect((await page.request.get(`/api/events?orgId=${data.organisation.id}`)).status()).toBe(403);
});

test('member staff, legacy owner, tenant separation and live-session revocation', async ({ page, data }) => {
  await login(page, data.manager.email, '/dashboard/events');
  expect((await page.request.get(`/api/events?orgId=${data.organisation.id}`)).status()).toBe(200);
  const foreign = await createOrganisationAccount();
  expect((await page.request.get(`/api/events?orgId=${foreign.organisation.id}`)).status()).toBe(403);
  expect((await page.request.get('/api/orders')).status()).toBe(403);
  await prisma.organisationStaff.update({where: {id: data.staff.id}, data: {role: 'finance_manager'}});
  const payload = { organisationId: data.organisation.id, title: data.event.title, description: 'changed', location: 'changed', startTime: data.event.startTime.toISOString(), endTime: data.event.endTime.toISOString(), ticketTypes: [] };
  const before = await prisma.event.findUniqueOrThrow({where: {id: data.event.id}});
  const mutation = () => page.request.patch(`/api/events/${data.event.id}`, {headers: {Origin: 'http://localhost:3100'}, data: payload});
  expect((await mutation()).status()).toBe(403);
  expect((await page.request.get('/api/orders')).status()).toBe(200);
  await prisma.organisationStaff.update({where: {id: data.staff.id}, data: {status: 'revoked'}});
  expect((await mutation()).status()).toBe(403);
  expect(await prisma.event.findUniqueOrThrow({where: {id: data.event.id}})).toEqual(before);
  await page.getByRole('button', {name: 'Sign out'}).click();
  await expect(page).toHaveURL('http://localhost:3100/');
  await prisma.organisationStaff.deleteMany({where: {userId: data.owner.id}});
  await login(page, data.owner.email, '/dashboard/events');
  expect((await page.request.get(`/api/events?orgId=${data.organisation.id}`)).status()).toBe(200);
});
