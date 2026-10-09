import { execFileSync } from "node:child_process";
import { test, expect, prisma, login, selectStaffContext, createEvent, createOrganisationAccount, createMember, createOrganisationStaff } from './fixtures';
import { createOrder } from '@/tests/helpers/test-data';

test('finance staff can page order history while another tenant cannot read it', async ({ page, data }) => {
  await prisma.organisationStaff.update({ where: { id: data.staff.id }, data: { role: 'finance_manager' } });
  const order = await createOrder({
    organisationId: data.organisation.id,
    eventId: data.event.id,
    ticketTypeId: data.ticket.id,
    userId: data.member.id,
    status: 'paid',
    paidAt: new Date()
  });
  await prisma.orderLifecycleEvent.createMany({ data: Array.from({ length: 27 }, (_, index) => ({
    orderId: order.id,
    sequence: index + 1,
    type: index === 0 ? 'legacy_baseline' as const : 'email_enqueued' as const,
    source: index === 0 ? 'legacy' as const : 'staff_action' as const,
    reason: `history_entry_${index + 1}`,
    actorUserId: index === 0 ? null : data.manager.id
  })) });
  await login(page, data.manager.email);
  await selectStaffContext(page, data.organisation.id);
  await page.goto(`/dashboard/orders/${order.id}`);
  const history = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Order history', exact: true }) });
  await expect(history.getByRole('listitem')).toHaveCount(25);
  await expect(history.getByText('Reason: history entry 27', { exact: true })).toBeVisible();
  await expect(history.getByText('This order predates lifecycle history.', { exact: false })).toBeVisible();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(history.getByRole('heading', { name: 'Order history', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await history.screenshot({ path: `test-results/order-history-${width}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await history.getByRole('link', { name: 'Older activity' }).click();
  await expect(history.getByRole('listitem')).toHaveCount(2);
  await expect(history.getByText('Reason: history entry 1', { exact: true })).toBeVisible();
  await history.getByRole('link', { name: 'Newer activity' }).click();
  await expect(history.getByRole('listitem')).toHaveCount(25);
  await expect(history.getByText('Reason: history entry 27', { exact: true })).toBeVisible();
  const foreign = await createOrganisationAccount();
  const foreignEvent = await createEvent({ organisationId: foreign.organisation.id });
  const foreignOrder = await createOrder({ organisationId: foreign.organisation.id, eventId: foreignEvent.id, ticketTypeId: foreignEvent.ticketTypes[0].id, status: 'paid', paidAt: new Date() });
  await page.goto(`/dashboard/orders/${foreignOrder.id}`);
  await expect(page.getByText('This page could not be found.')).toBeVisible();
});

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
  await expect(page.getByRole('status').filter({ hasText: 'If this address is eligible' })).toBeVisible();
  await expect(page).toHaveURL(/\/signup\?/);
  const identity = await prisma.user.findUniqueOrThrow({ where: { email } });
  expect(identity.emailVerifiedAt).toBeNull();
  await login(page, email, `/events/${data.event.id}`);
  await expect(page.getByText('Verify your email to use purchases and society features.')).toBeVisible();
  const csrf = await (await page.request.get('/api/security/csrf')).json();
  const blocked = await page.request.post('/api/payments/checkout/event', { headers: { Origin: 'http://localhost:3100', 'x-thunderstrux-csrf-token': csrf.token }, data: { eventId: data.event.id, ticketTypeId: data.ticket.id, quantity: 1 } });
  expect(blocked.status()).toBe(403);
  expect((await blocked.json()).error.message).toContain("Verify your email");
  execFileSync('node', ['scripts/process-notifications.mjs'], { stdio: 'pipe' });
  const captured = await (await page.request.get('http://mail-capture:8025/messages')).json();
  const message = captured.find((item: { data: { to: string } }) => item.data.to === email);
  const link = message.data.text.split('\n\n').at(-1);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:3100/');
  await page.goto("/verify-email");
  await page.goto(link);
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
  await expect.poll(() => page.url()).not.toContain('#');
  expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).toBeNull();
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByText('Email verified. Sign in to continue.')).toBeVisible();
  expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).not.toBeNull();
  const anonymousSession = await (await page.request.get('/api/auth/session')).json();
  expect(anonymousSession?.user).toBeFalsy();
  await page.getByRole('link', { name: 'Sign in to continue', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
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
  await expect(page.getByRole('status').filter({ hasText: 'If this address is eligible' })).toBeVisible();
  await expect(page).toHaveURL('http://localhost:3100/signup');
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
  expect((await page.request.post('/api/payments/checkout/event', {headers: { Origin: 'http://localhost:3100' }, data: body})).status()).toBe(403);
  const { token } = await (await page.request.get('/api/security/csrf')).json();
  expect((await page.request.post('/api/payments/checkout/event', {headers: { Origin: 'http://localhost:3100', 'x-thunderstrux-csrf-token': token }, data: body})).status()).toBe(503);
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

test('member staff, retired legacy owner, tenant separation and live-session revocation', async ({ page, data }) => {
  await login(page, data.manager.email);
  await selectStaffContext(page, data.organisation.id);
  await page.goto('/dashboard/events');
  expect((await page.request.get(`/api/events?orgId=${data.organisation.id}`)).status()).toBe(200);
  const foreign = await createOrganisationAccount();
  expect((await page.request.get(`/api/events?orgId=${foreign.organisation.id}`)).status()).toBe(403);
  expect((await page.request.get('/api/orders')).status()).toBe(403);
  await prisma.organisationStaff.update({where: {id: data.staff.id}, data: {role: 'finance_manager'}});
  const payload = { organisationId: data.organisation.id, title: data.event.title, description: 'changed', location: 'changed', startTime: data.event.startTime.toISOString(), endTime: data.event.endTime.toISOString(), ticketTypes: [] };
  const before = await prisma.event.findUniqueOrThrow({where: {id: data.event.id}});
  const { token } = await (await page.request.get('/api/security/csrf')).json();
  const mutation = () => page.request.patch(`/api/events/${data.event.id}`, {headers: {Origin: 'http://localhost:3100', 'x-thunderstrux-csrf-token': token}, data: payload});
  expect((await mutation()).status()).toBe(403);
  expect((await page.request.get('/api/orders')).status()).toBe(200);
  await prisma.organisationStaff.update({where: {id: data.staff.id}, data: {status: 'revoked'}});
  expect((await mutation()).status()).toBe(403);
  expect(await prisma.event.findUniqueOrThrow({where: {id: data.event.id}})).toEqual(before);
  await page.getByRole('button', {name: 'Sign out'}).click();
  await expect(page).toHaveURL('http://localhost:3100/');
  await prisma.organisationStaff.deleteMany({where: {userId: data.owner.id}});
  await login(page, data.owner.email, '/dashboard/events');
  expect((await page.request.get(`/api/events?orgId=${data.organisation.id}`)).status()).toBe(403);
});


test('member staff choose a tenant, retain it during this login and see role-aware mobile navigation', async ({ page, data }) => {
  const second = await createOrganisationAccount();
  await createOrganisationStaff({ organisationId: second.organisation.id, userId: data.manager.id, role: 'finance_manager' });
  await login(page, data.manager.email);
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();
  const chooser = page.getByLabel('Dashboard context');
  await chooser.selectOption(data.organisation.id);
  await expect(page.getByText('Organisation dashboard', { exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Organisation navigation' }).first();
  await expect(nav.getByRole('link', { name: 'Events', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Orders', exact: true })).toHaveCount(0);
  await page.goto(`/dashboard/events/${data.event.id}`);
  await expect(nav.getByRole('link', { name: 'Events', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Revenue', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Dashboard context').first()).toHaveValue(data.organisation.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText('Organisation menu', { exact: true }).click();
  const mobile = page.locator('details');
  await mobile.getByLabel('Dashboard context').selectOption(second.organisation.id);
  await expect(page.getByText('Current organisation', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: second.organisation.name, exact: true }).first()).toBeVisible();
  await page.getByText('Organisation menu', { exact: true }).click();
  await expect(mobile.getByRole('link', { name: 'Orders', exact: true })).toBeVisible();
  await prisma.organisationStaff.updateMany({ where: { userId: data.manager.id, organisationId: second.organisation.id }, data: { status: 'revoked' } });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();
  await expect(page.getByLabel('Dashboard context')).toHaveValue('personal');
  await page.goto('/tickets');
  await expect(page.getByRole('heading', { name: 'My tickets', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('http://localhost:3100/');
  await login(page, data.manager.email);
  await expect(page.getByLabel('Dashboard context')).toHaveValue('personal');
});


test('private staff invitation email supports explicit acceptance, resend and revocation', async ({ page, data, browser }) => {
  await login(page, data.owner.email, '/dashboard/settings/staff');
  await page.getByLabel('Email', { exact: true }).fill(data.member.email);
  await page.getByLabel('Invitation role', { exact: true }).selectOption('finance_manager');
  const responsePromise = page.waitForResponse(response => response.url().endsWith(`/api/orgs/${data.organisation.slug}/staff/invites`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create invite', exact: true }).click();
  const response = await responsePromise; expect(response.status()).toBe(201);
  const metadata = await response.json(); expect(Object.keys(metadata)).toEqual(['invite']);
  await expect(page.getByText('Invitation email queued.', { exact: false })).toBeVisible();
  execFileSync('node', ['scripts/process-notifications.mjs'], { stdio: 'pipe' });
  const messages = await (await page.request.get('http://mail-capture:8025/messages')).json();
  const message = messages.find((item: { data: { to: string; subject: string } }) => item.data.to === data.member.email && item.data.subject.includes('staff invitation'));
  expect(message).toBeTruthy(); const firstLink = message.data.text.split('\n\n').at(-1);
  expect(firstLink).toContain('/staff/invites/accept#token=');
  const context = await browser.newContext({ baseURL: 'http://localhost:3100' });
  try {
    const recipient = await context.newPage();
    await login(recipient, data.member.email);
    await recipient.goto('/staff/invites/accept'); await recipient.goto(firstLink);
    await expect.poll(() => recipient.url()).not.toContain('#');
    expect(await prisma.organisationStaff.count({ where: { userId: data.member.id } })).toBe(0);
    const pending = page.getByRole('listitem').filter({ hasText: data.member.email });
    await pending.getByRole('button', { name: 'Resend invitation' }).click();
    await expect(page.getByText('New invitation email queued.', { exact: false })).toBeVisible();
    await recipient.getByRole('button', { name: 'Accept staff invitation' }).click();
    await expect(recipient.getByRole('alert')).toContainText('Invitation is unavailable');
    execFileSync('node', ['scripts/process-notifications.mjs'], { stdio: 'pipe' });
    const updated = await (await page.request.get('http://mail-capture:8025/messages')).json();
    const nextLink = updated.filter((item: { data: { to: string; subject: string } }) => item.data.to === data.member.email && item.data.subject.includes('staff invitation')).at(-1).data.text.split('\n\n').at(-1);
    await recipient.goto(nextLink);
    await recipient.getByRole('button', { name: 'Accept staff invitation' }).click();
    await expect(recipient.getByRole('status')).toContainText('Staff access accepted');
    expect(await prisma.organisationStaff.findUniqueOrThrow({ where: { organisationId_userId: { organisationId: data.organisation.id, userId: data.member.id } } })).toMatchObject({ role: 'finance_manager', status: 'active' });
    await recipient.getByRole('link', { name: 'Open dashboard' }).click();
    await expect(recipient.getByLabel('Dashboard context')).toHaveValue('personal');
    await recipient.getByLabel('Dashboard context').selectOption(data.organisation.id);
    await expect(recipient.getByText('Organisation dashboard', { exact: true })).toBeVisible();
  } finally { await context.close(); }
  await page.getByLabel('Email', { exact: true }).fill(data.manager.email);
  await page.getByRole('button', { name: 'Create invite', exact: true }).click();
  const pending = page.getByRole('listitem').filter({ hasText: data.manager.email });
  await expect(pending).toBeVisible(); await pending.getByRole('button', { name: 'Revoke invitation' }).click();
  await expect(pending).toHaveCount(0);
});
