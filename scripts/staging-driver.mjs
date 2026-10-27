import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { chromium } from '@playwright/test';
import { hash } from 'bcryptjs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { allStagingScenarios, assertRunId, assertTestKey, assertTestDatabase, assertStripeIdentity, stripeApiVersion } from './e2e-guards.mjs';

// Drives one staging scenario step inside the run's test container: the app
// on real Stripe test mode (through the CLI listener), Resend and, when its
// values are set, a Spaces bucket. Everything it creates is named after the run.

assertTestDatabase(process.env.DATABASE_URL);
assertTestKey(process.env.STRIPE_SECRET_KEY);
const runId = assertRunId(process.env.E2E_RUN_ID);
const db = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {apiVersion: stripeApiVersion, timeout: 20_000, maxNetworkRetries: 1});
const [action, scenario] = process.argv.slice(2);
const baseURL = 'http://localhost:3100';
const account = process.env.STRIPE_TEST_CONNECTED_ACCOUNT;
const password = 'e2e-staging-only-password';
const statePath = name => `/app/test-results/private-${name}.json`;
const assert = (value, message) => { if (!value) throw new Error(message); };
const ownedOrg = name => `${runId}-${name}`;
// Resend's test sink accepts and "delivers" these, so no real inbox is ever written to.
const sinkEmail = (name, who) => `delivered+${ownedOrg(name)}-${who}@resend.dev`;
const resendConfigured = /^re_[A-Za-z0-9_]+$/.test(process.env.RESEND_API_KEY ?? '') && process.env.RESEND_API_KEY !== 're_capture_only';
const worker = name => execFileSync('node', [`scripts/${name}.mjs`], {stdio: 'pipe'});
let browser;

async function preflight() {
  let savedIdentity;
  try { savedIdentity = JSON.parse(await readFile('/app/test-results/private-identity.json', 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (action === 'cleanup') {
      for (const name of allStagingScenarios) {
        try { await readFile(statePath(name)); throw new Error('Missing Stripe identity with existing scenario state; manual recovery required'); }
        catch (stateError) { if (stateError.code !== 'ENOENT') throw stateError; }
      }
      return false;
    }
    assert(action === 'preflight', 'Missing original Stripe account identity');
  }
  const balance = await stripe.balance.retrieve();
  assert(balance.livemode === false, 'Stripe live mode refused');
  const platform = await stripe.accounts.retrieve();
  const identity = {platformId: platform.id, connectedAccountId: account, runId};
  if (savedIdentity) assertStripeIdentity(savedIdentity, identity);
  else await writeFile('/app/test-results/private-identity.json', JSON.stringify(identity), {mode: 0o600});
  if (action === 'cleanup') return true;
  const connected = await stripe.accounts.retrieve(account);
  assert(connected.charges_enabled && connected.details_submitted && connected.capabilities?.card_payments === 'active' && connected.capabilities?.transfers === 'active', 'Connected account is not ready');
  return true;
}

// The product's own storage adapter, pointed at the test bucket.
async function storageSmoke() {
  const names = ['SPACES_TEST_ENDPOINT', 'SPACES_TEST_BUCKET', 'SPACES_TEST_ACCESS_KEY', 'SPACES_TEST_SECRET_KEY'];
  const missing = names.filter(name => !process.env[name]);
  if (missing.length) return {status: 'blocked', missing};
  const endpoint = new URL(process.env.SPACES_TEST_ENDPOINT);
  assert(endpoint.protocol === 'https:', 'The Spaces endpoint must use https');
  Object.assign(process.env, {ASSET_STORAGE_ENDPOINT: endpoint.origin, ASSET_STORAGE_BUCKET: process.env.SPACES_TEST_BUCKET, ASSET_STORAGE_ACCESS_KEY: process.env.SPACES_TEST_ACCESS_KEY, ASSET_STORAGE_SECRET_KEY: process.env.SPACES_TEST_SECRET_KEY, ASSET_STORAGE_PATH_STYLE: 'false'});
  const { createJiti } = await import('jiti');
  const { assetStorage } = await createJiti(import.meta.url, {alias: {'@/': `${process.cwd()}/`}}).import('../lib/assets/storage.ts');
  const storage = assetStorage();
  const key = `t45/${runId}/probe`;
  const bytes = Buffer.from(`Thunderstrux T45 storage probe ${runId}`);
  await storage.put(key, bytes);
  try {
    assert(await storage.head(key), 'Stored object not found');
    assert((await storage.get(key))?.equals(bytes), 'Stored object differs');
  } finally {
    await storage.delete(key);
  }
  assert(!await storage.head(key), 'Object remains after delete');
  return {status: 'passed', endpoint: endpoint.host, key};
}

// Fixtures: one society per scenario, owned by the run.
async function society(name) {
  const id = ownedOrg(name);
  // Persist ownership before any app request can create a Stripe Session.
  await writeFile(statePath(name), JSON.stringify({organisationId: id, createdAt: Math.floor(Date.now() / 1000) - 60}), {mode: 0o600});
  await db.organisation.create({data: {id, name: id, slug: id, stripeAccountId: account, stripeChargesEnabled: true, stripePayoutsEnabled: true, stripeDetailsSubmitted: true}});
  const staff = await person(name, 'finance');
  await db.organisationStaff.create({data: {organisationId: id, userId: staff.id, role: 'finance_manager'}});
  return id;
}
async function person(name, who) {
  return db.user.create({data: {email: sinkEmail(name, who), password: await hash(password, 12), firstName: 'Staging', lastName: who, accountRole: 'member', emailVerifiedAt: new Date(), onboardingCompletedAt: new Date()}});
}
function ticketEvent(organisationId, ticket, compensationRefundMode = 'manual_review') {
  const startTime = new Date(Date.now() + 86_400_000);
  return db.event.create({data: {organisationId, title: organisationId, description: 'Isolated provider acceptance', location: 'Test only', status: 'published', startTime, salesCloseAt: startTime, endTime: new Date(startTime.getTime() + 3_600_000), compensationRefundMode,
    ticketTypes: {create: {name: 'Test ticket', quantity: 5, ...ticket}}}, include: {ticketTypes: true}});
}

async function signIn(email) {
  browser ??= await chromium.launch();
  const page = await (await browser.newContext({baseURL})).newPage();
  await page.goto('/login');
  await page.getByLabel('Email', {exact: true}).fill(email);
  await page.getByLabel('Password', {exact: true}).fill(password);
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await page.waitForURL(`${baseURL}/dashboard`);
  return page;
}
async function post(page, path, data) {
  const { token } = await (await page.request.get('/api/security/csrf')).json();
  return page.request.post(path, {headers: {Origin: baseURL, 'x-thunderstrux-csrf-token': token}, data});
}
async function asStaff(organisationId, name) {
  const page = await signIn(sinkEmail(name, 'finance'));
  assert((await post(page, '/api/me/context', {mode: 'staff', organisationId})).ok(), 'Staff context refused');
  return page;
}
// A guest confirms their address from the emailed link, as at checkout.
async function confirmGuest(page, email) {
  await page.getByRole('button', {name: 'Continue as guest'}).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', {name: 'Email me a link'}).click();
  await page.getByRole('status').filter({hasText: email}).waitFor();
  worker('process-notifications');
  const messages = await (await page.request.get('http://mail-capture:8025/messages')).json();
  const message = messages.filter(item => item.data.to === email && item.data.subject.includes('Confirm your email')).at(-1);
  assert(message, 'Guest confirmation email missing');
  await page.goto(message.data.text.split('\n\n').at(-1));
  await page.getByRole('button', {name: 'Continue'}).click();
}

async function poll(check, what = 'Stripe webhook reconciliation') {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise(done => setTimeout(done, 1000));
  }
  throw new Error(`${what} timed out`);
}
const orderState = id => db.order.findUniqueOrThrow({where: {id}, include: {tickets: true, reservation: true, emailOutboxJobs: true, compensationRefundJob: true, lifecycleEvents: {orderBy: {sequence: 'asc'}}}});
const commerceState = id => db.commerceOrder.findUniqueOrThrow({where: {id}, include: {lines: true}});
// The listed transitions happen in this order, the history has no gaps, and one names Stripe's event.
function assertLifecycle(order, types, event) {
  const seen = order.lifecycleEvents.map(item => item.type);
  let from = 0;
  for (const type of types) { from = seen.indexOf(type, from) + 1; assert(from > 0, `Lifecycle is missing ${type}`); }
  assert(order.lifecycleEvents.every((item, index) => item.sequence === index + 1), 'Lifecycle sequence mismatch');
  assert(order.lifecycleEvents.some(item => item.stripeEventId === event.id && item.stripeSessionId === event.data.object.id), 'Lifecycle Stripe event correlation missing');
}
async function eventFor(objectId, types) {
  const events = await stripe.events.list({types, created: {gte: Math.floor(Date.now() / 1000) - 3600}, limit: 100});
  const event = events.data.find(item => item.data.object.id === objectId);
  assert(event && !event.livemode, 'Real Stripe event not found');
  return event;
}

// Starts a ticket checkout from the page's Pay button and checks the Session Stripe made.
async function ticketCheckout(page, name, event, payLabel, {amount, guest = false}) {
  const response = page.waitForResponse(item => item.url().endsWith('/api/payments/checkout/event') && item.request().method() === 'POST');
  await page.getByRole('button', {name: payLabel}).click();
  assert((await response).ok(), 'App Checkout creation failed');
  const order = await db.order.findFirstOrThrow({where: {eventId: event.id}});
  const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
  assert(session.url && new URL(session.url).hostname === 'checkout.stripe.com', 'Unexpected Checkout host');
  assert(!session.livemode && session.currency === 'aud' && session.amount_total === amount, 'Checkout amount/mode mismatch');
  assert(session.metadata.orderId === order.id && session.metadata.eventId === event.id && session.metadata.organisationId === ownedOrg(name) && session.metadata.ticketTypeId === event.ticketTypes[0].id && session.metadata.quantity === '1', 'Checkout metadata mismatch');
  const returnTo = guest ? `${baseURL}/guest/orders/${order.id}` : `${baseURL}/success?`;
  assert(session.success_url.startsWith(returnTo) && session.cancel_url === `${baseURL}/cancel?order=${order.id}`, 'Checkout return origin mismatch');
  await page.waitForURL('https://checkout.stripe.com/**', {timeout: 30_000});
  return {orderId: order.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, sessionId: session.id, url: session.url, amount};
}
// Membership and merchandise checkouts through the commerce API, as the order pages call it.
async function commerceCheckout(page, name, family, selection, amount) {
  const response = await post(page, `/api/payments/checkout/${family}`, {organisationId: ownedOrg(name), selection, expectedTotal: amount, idempotencyKey: `t45-${randomUUID()}`});
  assert(response.ok(), `App ${family} checkout failed (${response.status()})`);
  const { kind, url } = await response.json();
  assert(kind === 'stripe', `Expected a Stripe checkout, got ${kind}`);
  const order = await db.commerceOrder.findFirstOrThrow({where: {organisationId: ownedOrg(name), kind: family}});
  const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
  assert(session.url === url && new URL(url).hostname === 'checkout.stripe.com', 'Unexpected Checkout URL');
  assert(!session.livemode && session.currency === 'aud' && session.amount_total === amount, 'Checkout amount/mode mismatch');
  assert(session.metadata.family === family && session.metadata.commerceOrderId === order.id && session.metadata.organisationId === ownedOrg(name), 'Checkout metadata mismatch');
  return {commerceOrderId: order.id, sessionId: session.id, url, amount};
}

// Stripe's side of a paid Session: a destination charge to the society with the order's fee.
async function destinationCharge(sessionId, amount, fee) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {expand: ['payment_intent']});
  const intent = session.payment_intent;
  assert(session.payment_status === 'paid' && session.amount_total === amount && typeof intent === 'object' && intent.amount_received === amount, 'Payment amount mismatch');
  assert(fee > 0 && intent.application_fee_amount === fee && intent.transfer_data?.destination === account && intent.on_behalf_of === account, 'Destination charge configuration mismatch');
  return intent;
}
// One full refund on Stripe that reverses the transfer and returns the fee.
async function providerRefund(intentId, amount) {
  const refund = await poll(async () => {
    const refunds = await stripe.refunds.list({payment_intent: intentId, limit: 10});
    assert(refunds.data.length <= 1, 'More than one provider refund');
    return refunds.data[0]?.status === 'succeeded' ? refunds.data[0] : null;
  }, 'Stripe refund');
  assert(refund.amount === amount && refund.transfer_reversal, 'Refund amount or transfer reversal mismatch');
  // A destination charge's fee hangs off the society's payment, so read it from the charge.
  const intent = await stripe.paymentIntents.retrieve(intentId, {expand: ['latest_charge.application_fee']});
  const fee = intent.latest_charge.application_fee;
  assert(fee && fee.amount > 0 && fee.amount_refunded === fee.amount, 'Platform fee was not refunded');
  const event = await eventFor(refund.id, ['refund.created', 'refund.updated']);
  return {refundId: refund.id, eventId: event.id, amount, feeRefunded: fee.amount_refunded};
}
// Sends the order's queued ticket email through Resend: provider acceptance, not inbox delivery.
async function ticketEmail(orderId) {
  if (!resendConfigured) return {status: 'blocked'};
  worker('process-email-outbox');
  const job = await db.emailOutbox.findFirstOrThrow({where: {orderId}});
  assert(job.status === 'sent' && job.providerMessageId, `Resend did not accept the ticket email (${job.status})`);
  return {status: 'accepted', provider: 'resend', messageId: job.providerMessageId};
}
async function paidTicket(data) {
  const order = await poll(async () => { const item = await orderState(data.orderId); return item.status === 'paid' ? item : null; });
  assert(order.reservation?.status === 'confirmed' && order.tickets.length === 1 && order.tickets[0].validity === 'active' && order.emailOutboxJobs.length === 1, 'Fulfilment mismatch');
  assert((await db.ticketType.findUniqueOrThrow({where: {id: data.ticketTypeId}})).quantity === 4, 'Inventory mismatch');
  const intent = await destinationCharge(data.sessionId, data.amount, order.feeAmount);
  const event = await eventFor(data.sessionId, ['checkout.session.completed']);
  assertLifecycle(order, ['order_created', 'stripe_session_attached', 'payment_fulfilled'], event);
  return {order, intent, event, email: await ticketEmail(order.id)};
}
async function paidCommerce(data) {
  const order = await poll(async () => { const item = await commerceState(data.commerceOrderId); return item.status === 'paid' && item.fulfilledAt ? item : null; });
  const intent = await destinationCharge(data.sessionId, data.amount, order.feeAmount);
  const event = await eventFor(data.sessionId, ['checkout.session.completed']);
  return {order, intent, event};
}

const prepare = {
  async free(name) {
    const organisationId = await society(name);
    const event = await ticketEvent(organisationId, {price: 0});
    const buyer = await person(name, 'buyer');
    const page = await signIn(buyer.email);
    await page.goto(`/events/${event.id}`);
    await page.getByRole('button', {name: 'Get free tickets'}).click();
    await page.getByRole('button', {name: 'Confirm free registration'}).click();
    await page.getByRole('heading', {name: 'Free registration confirmed'}).waitFor();
    const order = await db.order.findFirstOrThrow({where: {eventId: event.id}});
    return {orderId: order.id, ticketTypeId: event.ticketTypes[0].id};
  },
  async success(name) {
    const event = await ticketEvent(await society(name), {price: 1200});
    const buyer = await person(name, 'buyer');
    const page = await signIn(buyer.email);
    // The real path: Buy tickets opens the review page, Pay starts Stripe Checkout.
    await page.goto(`/events/${event.id}`);
    await page.getByRole('button', {name: 'Buy tickets'}).click();
    return {email: buyer.email, ...await ticketCheckout(page, name, event, 'Pay $12.00', {amount: 1200})};
  },
  async decline(name) { return prepare.success(name); },
  async cancel(name) { return prepare.success(name); },
  // A free membership with member prices, then a ticket at the member price.
  async member(name) {
    const organisationId = await society(name);
    const event = await ticketEvent(organisationId, {price: 1500, memberPrice: 900});
    const plan = await db.membershipProduct.create({data: {organisationId, name: 'Staging free membership', priceAmount: 0, entitlements: ['member_prices'], status: 'published', publishedAt: new Date(), startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 100 * 86_400_000)}});
    const buyer = await person(name, 'buyer');
    const page = await signIn(buyer.email);
    const joined = await post(page, '/api/payments/checkout/membership', {organisationId, selection: {planId: plan.id}, expectedTotal: 0, idempotencyKey: `t45-${randomUUID()}`});
    assert(joined.ok() && (await joined.json()).kind === 'fulfilled', 'Free membership was not fulfilled');
    await page.goto(`/events/${event.id}/checkout?ticketTypeId=${event.ticketTypes[0].id}&quantity=1`);
    return ticketCheckout(page, name, event, 'Pay $9.00', {amount: 900});
  },
  async guest(name) {
    const event = await ticketEvent(await society(name), {price: 1500});
    browser ??= await chromium.launch();
    const page = await (await browser.newContext({baseURL})).newPage();
    await page.goto(`/events/${event.id}`);
    await confirmGuest(page, sinkEmail(name, 'guest'));
    return ticketCheckout(page, name, event, 'Pay $15.00', {amount: 1500, guest: true});
  },
  async membership(name) {
    const organisationId = await society(name);
    const plan = await db.membershipProduct.create({data: {organisationId, name: 'Staging paid membership', priceAmount: 2500, entitlements: ['member_prices'], status: 'published', publishedAt: new Date(), startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 100 * 86_400_000)}});
    const page = await signIn((await person(name, 'buyer')).email);
    return commerceCheckout(page, name, 'membership', {planId: plan.id}, 2500);
  },
  // Two lines of different options, paid together, then fully refunded.
  async merchandise(name) {
    const organisationId = await society(name);
    const now = new Date();
    const product = await db.merchandiseProduct.create({data: {organisationId, name: 'Staging hoodie', status: 'published', publishedAt: now, firstPublishedAt: now}});
    const variant = (size, priceAmount, position) => db.merchandiseVariant.create({data: {productId: product.id, organisationId, size, sku: `T45-${runId.slice(-24).toUpperCase()}-${size.toUpperCase()}`, priceAmount, remaining: 5, position}});
    const large = await variant('Large', 2000, 0);
    const small = await variant('Small', 1500, 1);
    const items = [{variantId: large.id, quantity: 2}, {variantId: small.id, quantity: 1}];
    const page = await signIn((await person(name, 'buyer')).email);
    const { quote } = await (await page.request.post('/api/merchandise/quote', {data: {society: organisationId, items}})).json();
    assert(quote.total === 5500 && quote.problems.length === 0, 'Merchandise quote mismatch');
    return {variants: [large.id, small.id], ...await commerceCheckout(page, name, 'merchandise', {items, quoteVersion: quote.version}, 5500)};
  },
  // The order expires locally while its Session stays open; paying it then needs compensation.
  async compensation(name) {
    const event = await ticketEvent(await society(name), {price: 1200}, 'automatic_full');
    const page = await signIn((await person(name, 'buyer')).email);
    await page.goto(`/events/${event.id}/checkout?ticketTypeId=${event.ticketTypes[0].id}&quantity=1`);
    const data = await ticketCheckout(page, name, event, 'Pay $12.00', {amount: 1200});
    await db.ticketReservation.updateMany({where: {orderId: data.orderId}, data: {expiresAt: new Date(Date.now() - 60_000)}});
    worker('process-stale-orders');
    assert((await orderState(data.orderId)).status === 'expired', 'The order did not expire locally');
    return data;
  },
  // PAY-003: the same membership and merchandise checkouts, then what Stripe does to them.
  async 'commerce-dispute'(name) { return prepare.membership(name); },
  async 'commerce-outside-refund'(name) { return prepare.merchandise(name); },
  async 'commerce-compensation'(name) {
    const data = await prepare.merchandise(name);
    // Past the stale worker's grace locally, while the Session stays payable.
    await db.commerceOrder.update({where: {id: data.commerceOrderId}, data: {expiresAt: new Date(Date.now() - 10 * 60_000)}});
    worker('process-stale-orders');
    assert((await commerceState(data.commerceOrderId)).status === 'expired', 'The order did not expire locally');
    return data;
  }
};

const verify = {
  async free(data) {
    const order = await orderState(data.orderId);
    assert(order.status === 'paid' && order.paymentKind === 'free' && !order.stripeSessionId && order.tickets.length === 1 && order.emailOutboxJobs.length === 1, 'Free fulfilment mismatch');
    assertLifecycleTypes(order, ['order_created', 'free_fulfilled', 'email_enqueued']);
    return {orderId: order.id, email: await ticketEmail(order.id)};
  },
  async success(data) {
    const { order, intent, event, email } = await paidTicket(data);
    const page = await signIn(data.email);
    await page.goto('/tickets');
    assert(await page.getByText(data.organisationId, {exact: true}).count() > 0, 'Purchased event missing from buyer tickets');
    // Finance refunds the whole order through the app; Stripe's refund event settles it.
    const staff = await asStaff(data.organisationId, scenario);
    const refunded = await post(staff, `/api/orders/${order.id}/refunds`, {reason: 'T45 full refund acceptance', confirmation: order.id.slice(-6).toUpperCase()});
    assert([200, 202].includes(refunded.status()), `Refund request refused (${refunded.status()})`);
    const after = await poll(async () => { const item = await orderState(order.id); return item.refundStatus === 'refunded' ? item : null; }, 'Refund reconciliation');
    assert(after.tickets.every(ticket => ticket.validity === 'void'), 'Refunded tickets remain valid');
    return {eventId: event.id, email, fee: intent.application_fee_amount, refund: await providerRefund(intent.id, data.amount)};
  },
  async decline(data) { return unpaid(data, true); },
  async cancel(data) { return {...await unpaid(data, false), cancelNavigation: 'manually-attested'}; },
  async member(data) {
    const { order, intent, event, email } = await paidTicket(data);
    assert(order.unitPrice === 900 && order.membershipGrantId, 'Member price was not applied from the membership');
    return {eventId: event.id, email, fee: intent.application_fee_amount, unitPrice: order.unitPrice};
  },
  async guest(data) {
    const { order, intent, event, email } = await paidTicket(data);
    assert(order.userId === null && order.guestIdentityId, 'Guest order is not held by the verified guest');
    return {eventId: event.id, email, fee: intent.application_fee_amount};
  },
  async membership(data) {
    const { order, intent, event } = await paidCommerce(data);
    const grant = await db.membershipGrant.findFirst({where: {commerceOrderLineId: order.lines[0].id}});
    assert(grant && !grant.revokedAt && grant.entitlements.includes('member_prices'), 'Membership was not granted');
    return {eventId: event.id, fee: intent.application_fee_amount, grantId: grant.id};
  },
  async merchandise(data) {
    const { order, intent, event } = await paidCommerce(data);
    assert(order.lines.length === 2, 'Expected two merchandise lines');
    const stock = await db.merchandiseVariant.findMany({where: {id: {in: data.variants}}});
    assert(stock.find(item => item.id === data.variants[0]).remaining === 3 && stock.find(item => item.id === data.variants[1]).remaining === 4, 'Merchandise stock mismatch');
    const staff = await asStaff(data.organisationId, scenario);
    const refunded = await post(staff, `/api/orgs/${data.organisationId}/merchandise/orders/${order.id}/refund`, {reason: 'T45 full refund acceptance', confirmation: order.id.slice(-6).toUpperCase()});
    assert([200, 202].includes(refunded.status()), `Refund request refused (${refunded.status()})`);
    await poll(async () => (await commerceState(order.id)).refundStatus === 'refunded', 'Refund reconciliation');
    return {eventId: event.id, fee: intent.application_fee_amount, lines: order.lines.length, refund: await providerRefund(intent.id, data.amount)};
  },
  // Paid after local expiry: no tickets, and the automatic compensation refund goes back to the card.
  async compensation(data) {
    const order = await poll(async () => { const item = await orderState(data.orderId); return item.requiresCompensationReview && item.compensationRefundJob ? item : null; });
    assert(order.tickets.length === 0 && order.emailOutboxJobs.length === 0, 'A paid-after-expiry order issued tickets');
    const intent = await destinationCharge(data.sessionId, data.amount, order.feeAmount);
    const event = await eventFor(data.sessionId, ['checkout.session.completed']);
    assertLifecycle(order, ['order_created', 'stripe_session_attached', 'order_expired', 'compensation_required'], event);
    worker('process-compensation-refunds');
    await poll(async () => (await orderState(order.id)).compensationRefundJob.state === 'refunded', 'Compensation refund');
    return {eventId: event.id, fee: intent.application_fee_amount, refund: await providerRefund(intent.id, data.amount)};
  },
  // A dispute Stripe opens on a paid membership, then loses: the membership ends.
  async 'commerce-dispute'(data) {
    const { order, intent, event } = await paidCommerce(data);
    const dispute = await poll(async () => (await commerceState(order.id)).disputeStatus === 'open' && (await stripe.disputes.list({payment_intent: intent.id, limit: 1})).data[0], 'Dispute reconciliation');
    const opened = await eventFor(dispute.id, ['charge.dispute.created']);
    // The app stages a draft answer for the operator, never submitted.
    const staged = await poll(async () => { const current = await stripe.disputes.retrieve(dispute.id); return current.evidence_details.has_evidence ? current : null; }, 'Staged dispute evidence');
    assert(staged.evidence_details.submission_count === 0 && staged.evidence.customer_email_address === order.buyerEmailSnapshot, 'The staged dispute evidence was submitted or names someone else');
    // Stripe test mode closes a dispute as lost when given this evidence.
    await stripe.disputes.update(dispute.id, {evidence: {uncategorized_text: 'losing_evidence'}});
    await poll(async () => (await commerceState(order.id)).disputeStatus === 'lost', 'Lost dispute reconciliation');
    const grant = await db.membershipGrant.findFirstOrThrow({where: {commerceOrderLineId: order.lines[0].id}});
    assert(grant.revokedAt, 'A lost dispute left the membership active');
    const closed = await eventFor(dispute.id, ['charge.dispute.closed']);
    // PAY-004: the refunds worker takes the disputed amount back from the society's transfer.
    worker('process-compensation-refunds');
    const recovered = await poll(async () => { const row = await db.purchaseDispute.findUnique({where: {stripeDisputeId: dispute.id}}); return row?.reversalStatus === 'succeeded' ? row : null; }, 'Dispute transfer reversal');
    const charge = await stripe.charges.retrieve(dispute.charge, {expand: ['transfer']});
    const reversal = charge.transfer.reversals.data.find((item) => item.id === recovered.stripeTransferReversalId);
    assert(reversal && reversal.amount === dispute.amount && recovered.reversalAmount === dispute.amount && reversal.metadata.disputeId === dispute.id, 'The lost dispute was not taken back from the society');
    return {eventId: event.id, fee: intent.application_fee_amount, disputeId: dispute.id, transferReversalId: reversal.id, moreEventIds: [opened.id, closed.id]};
  },
  // Part refunded outside Thunderstrux: flagged, reviewed by staff, and the app refunds only the rest.
  async 'commerce-outside-refund'(data) {
    const { order, intent, event } = await paidCommerce(data);
    const outside = await stripe.refunds.create({payment_intent: intent.id, amount: 1500, reverse_transfer: true, refund_application_fee: true});
    await poll(async () => (await commerceState(order.id)).externalRefundedAmount === 1500, 'Outside refund reconciliation');
    const outsideEvent = await eventFor(outside.id, ['refund.created', 'refund.updated']);
    const staff = await asStaff(data.organisationId, scenario);
    assert((await post(staff, `/api/orders/${order.id}/review`, {action: 'mark_reviewed'})).ok(), 'Review refused');
    assert((await commerceState(order.id)).externalRefundReviewedAt, 'Review not recorded');
    const refunded = await post(staff, `/api/orgs/${data.organisationId}/merchandise/orders/${order.id}/refund`, {reason: 'T45 refund of the rest', confirmation: order.id.slice(-6).toUpperCase()});
    assert([200, 202].includes(refunded.status()), `Refund request refused (${refunded.status()})`);
    await poll(async () => (await commerceState(order.id)).refundStatus === 'refunded', 'Refund reconciliation');
    const refunds = (await stripe.refunds.list({payment_intent: intent.id, limit: 10})).data.filter(item => item.status === 'succeeded');
    const own = refunds.find(item => item.metadata?.refundRequestId);
    assert(refunds.length === 2 && own?.amount === data.amount - 1500 && own.transfer_reversal, 'Refund of the rest mismatch');
    const ownEvent = await eventFor(own.id, ['refund.created', 'refund.updated']);
    return {eventId: event.id, fee: intent.application_fee_amount, outsideRefund: {refundId: outside.id, amount: 1500}, refund: {refundId: own.id, eventId: ownEvent.id, amount: own.amount}, moreEventIds: [outsideEvent.id]};
  },
  // Paid after the order expired locally: nothing fulfilled, and the refund worker returns it all.
  async 'commerce-compensation'(data) {
    const order = await poll(async () => { const item = await commerceState(data.commerceOrderId); return item.requiresCompensationReview || item.refundStatus ? item : null; });
    assert(!order.fulfilledAt && order.status === 'failed', 'A paid-after-expiry order was fulfilled');
    const intent = await destinationCharge(data.sessionId, data.amount, order.feeAmount);
    const event = await eventFor(data.sessionId, ['checkout.session.completed']);
    worker('process-compensation-refunds');
    await poll(async () => (await commerceState(order.id)).refundStatus === 'refunded', 'Compensation refund');
    const stock = await db.merchandiseVariant.findMany({where: {id: {in: data.variants}}});
    assert(stock.every(item => item.remaining === 5), 'An unfilled order changed stock');
    return {eventId: event.id, fee: intent.application_fee_amount, refund: await providerRefund(intent.id, data.amount)};
  }
};
function assertLifecycleTypes(order, types) {
  assert(JSON.stringify(order.lifecycleEvents.map(item => item.type)) === JSON.stringify(types), 'Lifecycle transition history mismatch');
}
async function unpaid(data, declined) {
  const before = await orderState(data.orderId);
  assert(before.status === 'pending' && before.tickets.length === 0 && before.emailOutboxJobs.length === 0, 'Unpaid checkout fulfilled unexpectedly');
  if (declined) {
    const session = await stripe.checkout.sessions.retrieve(data.sessionId, {expand: ['payment_intent']});
    assert(typeof session.payment_intent === 'object' && session.payment_intent?.last_payment_error, 'No real declined payment evidence');
  }
  await stripe.checkout.sessions.expire(data.sessionId);
  const order = await poll(async () => { const item = await orderState(data.orderId); return item.status === 'expired' ? item : null; });
  assert(order.reservation?.status === 'expired' && order.tickets.length === 0 && order.emailOutboxJobs.length === 0, 'Expiry mismatch');
  assert((await db.ticketType.findUniqueOrThrow({where: {id: data.ticketTypeId}})).quantity === 5, 'Unpaid checkout decremented inventory');
  const event = await eventFor(data.sessionId, ['checkout.session.expired']);
  assertLifecycle(order, ['order_created', 'stripe_session_attached', 'order_expired'], event);
  return {eventId: event.id};
}

// A Session belongs to the run when its society and its order both do.
async function ownedSession(session, name, data) {
  assert(!session.livemode && session.metadata?.organisationId === ownedOrg(name), 'Session ownership mismatch');
  const order = session.metadata.commerceOrderId
    ? await db.commerceOrder.findUnique({where: {id: session.metadata.commerceOrderId}})
    : await db.order.findUnique({where: {id: session.metadata.orderId}});
  assert(order?.organisationId === ownedOrg(name), 'Session cleanup metadata mismatch');
  if (data?.sessionId === session.id) assert(order.id === (data.orderId ?? data.commerceOrderId), 'Known Session ownership mismatch');
}

const readState = async name => JSON.parse(await readFile(statePath(name), 'utf8'));
try {
  if (action === 'storage') {
    console.log(`E2E_STORAGE:${JSON.stringify(await storageSmoke())}`);
  } else if (!await preflight()) {
    console.log('No Stripe resources created by this run');
  } else if (action === 'prepare') {
    assert(allStagingScenarios.includes(scenario), 'Unknown scenario');
    const data = await prepare[scenario](scenario);
    await writeFile(statePath(scenario), JSON.stringify({...await readState(scenario), ...data}), {mode: 0o600});
  } else if (action === 'handoff') {
    const data = await readState(scenario);
    assert(data.organisationId === ownedOrg(scenario) && data.url, 'Scenario ownership mismatch');
    console.log(`E2E_PRIVATE:${JSON.stringify({url: data.url})}`);
  } else if (action === 'verify') {
    const data = await readState(scenario);
    assert(data.organisationId === ownedOrg(scenario), 'Scenario ownership mismatch');
    const evidence = await verify[scenario](data);
    const eventIds = [evidence.eventId, evidence.refund?.eventId, ...(evidence.moreEventIds ?? [])].filter(Boolean);
    await writeFile(`/app/test-results/payment-${scenario}.json`, JSON.stringify({scenario, sessionId: data.sessionId ?? null, ...evidence, eventIds, verifiedAt: new Date().toISOString(), passed: true}));
  } else if (action === 'cleanup') {
    for (const name of allStagingScenarios) {
      let data;
      try { data = await readState(name); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      assert(data.organisationId === ownedOrg(name), 'Cleanup ownership mismatch');
      if (data.sessionId) {
        const known = await stripe.checkout.sessions.retrieve(data.sessionId);
        await ownedSession(known, name, data);
        if (known.status === 'open') await stripe.checkout.sessions.expire(known.id);
      }
      // Bounded recovery also finds Sessions created before the order recorded them.
      let startingAfter;
      let exhausted = false;
      for (let page = 0; page < 10; page++) {
        const sessions = await stripe.checkout.sessions.list({created: {gte: data.createdAt}, limit: 100, ...(startingAfter ? {starting_after: startingAfter} : {})});
        for (const session of sessions.data) {
          if (session.metadata?.organisationId !== ownedOrg(name)) continue;
          await ownedSession(session, name);
          if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
        }
        if (!sessions.has_more) { exhausted = true; break; }
        startingAfter = sessions.data.at(-1).id;
      }
      assert(exhausted, 'Recovery lookup exceeded safety bound; retain manifest for manual recovery');
      await unlink(statePath(name));
    }
    await unlink('/app/test-results/private-identity.json');
  } else assert(action === 'preflight', 'Unknown staging action');
} catch (error) {
  // Provider errors can include request details: expose only known validation messages.
  console.error(error instanceof Stripe.errors.StripeError ? `Stripe request failed: ${error.type}` : error.message.replace(/(?:sk_test_|whsec_|re_)[A-Za-z0-9_]+/g, '[redacted]'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await db.$disconnect();
}
