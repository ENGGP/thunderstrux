import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { chromium } from '@playwright/test';
import { hash } from 'bcryptjs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { assertRunId, assertTestKey, assertTestDatabase, assertStripeIdentity } from './e2e-guards.mjs';

assertTestDatabase(process.env.DATABASE_URL);
assertTestKey(process.env.STRIPE_SECRET_KEY);
const runId = assertRunId(process.env.E2E_RUN_ID);
const db = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {apiVersion: '2026-03-25.dahlia', timeout: 20_000, maxNetworkRetries: 1});
const [action, scenario] = process.argv.slice(2);
const baseURL = 'http://localhost:3100';
const statePath = name => `/app/test-results/private-${name}.json`;
const assert = (value, message) => { if (!value) throw new Error(message); };
const ownedOrg = name => `${runId}-${name}`;
let browser;

async function preflight() {
  let savedIdentity;
  try { savedIdentity = JSON.parse(await readFile('/app/test-results/private-identity.json', 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (action === 'cleanup') {
      for (const name of ['success', 'decline', 'cancel']) {
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
  const identity = {platformId: platform.id, connectedAccountId: process.env.STRIPE_TEST_CONNECTED_ACCOUNT, runId};
  if (savedIdentity) assertStripeIdentity(savedIdentity, identity);
  else await writeFile('/app/test-results/private-identity.json', JSON.stringify(identity), {mode: 0o600});
  if (action === 'cleanup') return true;
  const account = await stripe.accounts.retrieve(process.env.STRIPE_TEST_CONNECTED_ACCOUNT);
  assert(account.charges_enabled && account.details_submitted && account.capabilities?.card_payments === 'active' && account.capabilities?.transfers === 'active', 'Connected account is not ready');
  return true;
}
async function openBuyer(email) {
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${baseURL}/login`);
  await page.getByLabel('Email', {exact: true}).fill(email);
  await page.getByLabel('Password', {exact: true}).fill('p216-staging-only-password');
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await page.waitForURL(`${baseURL}/dashboard`);
  return page;
}
async function poll(check) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise(done => setTimeout(done, 1000));
  }
  throw new Error('Stripe webhook reconciliation timed out');
}
async function orderState(id) {
  return db.order.findUniqueOrThrow({where: {id}, include: {tickets: true, reservation: true, emailOutboxJobs: true, lifecycleEvents: {orderBy: {sequence: 'asc'}}}});
}
function assertLifecycle(order, types, event) {
  assert(JSON.stringify(order.lifecycleEvents.map(item => item.type)) === JSON.stringify(types), 'Lifecycle transition history mismatch');
  assert(order.lifecycleEvents.every((item, index) => item.sequence === index + 1), 'Lifecycle sequence mismatch');
  assert(order.lifecycleEvents.some(item => item.stripeEventId === event.id && item.stripeSessionId === event.data.object.id), 'Lifecycle Stripe event correlation missing');
}
async function eventFor(sessionId, type) {
  const events = await stripe.events.list({type, created: {gte: Math.floor(Date.now() / 1000) - 3600}, limit: 100});
  const event = events.data.find(item => item.data.object.id === sessionId);
  assert(event && !event.livemode, 'Real Stripe event not found');
  assert(event.api_version === '2026-03-25.dahlia', 'Webhook API version differs from application; configure listener/account version before acceptance');
  return event;
}

try {
  if (!await preflight()) {
    console.log('No Stripe resources created by this run');
  } else if (action === 'prepare') {
    assert(['success', 'decline', 'cancel'].includes(scenario), 'Unknown scenario');
    const id = ownedOrg(scenario);
    // Persist ownership before any app request can create a Stripe Session.
    await writeFile(statePath(scenario), JSON.stringify({organisationId: id, createdAt: Math.floor(Date.now()/1000)}), {mode: 0o600});
    const user = await db.user.create({data: {email: `${id}@example.com`, password: await hash('p216-staging-only-password', 12), firstName: 'Staging', lastName: 'Buyer', accountRole: 'member', onboardingCompletedAt: new Date()}});
    await db.organisation.create({data: {id, name: id, slug: id, stripeAccountId: process.env.STRIPE_TEST_CONNECTED_ACCOUNT, stripeChargesEnabled: true, stripeDetailsSubmitted: true}});
    const event = await db.event.create({data: {organisationId: id, title: id, description: 'Isolated Stripe acceptance', location: 'Test only', status: 'published', startTime: new Date(Date.now()+86400000), endTime: new Date(Date.now()+90000000), ticketTypes: {create: {name: 'Test ticket', price: 1200, quantity: 5}}}, include: {ticketTypes: true}});
    const page = await openBuyer(user.email);
    await page.goto(`${baseURL}/events/${event.id}`);
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/payments/checkout/event') && response.request().method() === 'POST');
    await page.getByRole('button', {name: 'Buy Ticket'}).click();
    const response = await responsePromise;
    assert(response.ok(), 'App Checkout creation failed');
    const order = await db.order.findFirstOrThrow({where: {eventId: event.id}});
    const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId, {expand: ['payment_intent']});
    // Navigation to Stripe can discard the browser's Checkout response body.
    const url = session.url;
    assert(url && new URL(url).hostname === 'checkout.stripe.com', 'Unexpected Checkout host');
    assert(!session.livemode && session.currency === 'aud' && session.amount_total === 1200, 'Checkout amount/mode mismatch');
    assert(session.metadata.orderId === order.id && session.metadata.eventId === event.id && session.metadata.organisationId === id && session.metadata.ticketTypeId === event.ticketTypes[0].id && session.metadata.quantity === '1', 'Checkout metadata mismatch');
    assert(session.success_url.startsWith(`${baseURL}/success?`) && session.cancel_url === `${baseURL}/cancel`, 'Checkout return origin mismatch');
    await writeFile(statePath(scenario), JSON.stringify({organisationId: id, eventId: event.id, orderId: order.id, ticketTypeId: event.ticketTypes[0].id, sessionId: session.id, email: user.email, url, createdAt: Math.floor(Date.now()/1000)-60}));
    await page.waitForURL('https://checkout.stripe.com/**', {timeout: 30_000});
  } else if (action === 'handoff') {
    assert(['success', 'decline', 'cancel'].includes(scenario), 'Unknown scenario');
    const data = JSON.parse(await readFile(statePath(scenario), 'utf8'));
    assert(data.organisationId === ownedOrg(scenario), 'Scenario ownership mismatch');
    console.log(`P216_PRIVATE:${JSON.stringify({url: data.url})}`);
  } else if (action === 'verify') {
    const data = JSON.parse(await readFile(statePath(scenario), 'utf8'));
    assert(data.organisationId === ownedOrg(scenario), 'Scenario ownership mismatch');
    let event;
    if (scenario === 'success') {
      const order = await poll(async () => { const item = await orderState(data.orderId); return item.status === 'paid' ? item : null; });
      assert(order.reservation?.status === 'confirmed' && order.tickets.length === 1 && order.emailOutboxJobs.length === 1, 'Fulfilment mismatch');
      assert((await db.ticketType.findUniqueOrThrow({where: {id: data.ticketTypeId}})).quantity === 4, 'Inventory mismatch');
      const session = await stripe.checkout.sessions.retrieve(data.sessionId, {expand: ['payment_intent']});
      const intent = session.payment_intent;
      assert(session.payment_status === 'paid' && typeof intent === 'object' && intent.application_fee_amount === 120 && intent.transfer_data?.destination === process.env.STRIPE_TEST_CONNECTED_ACCOUNT && intent.on_behalf_of === process.env.STRIPE_TEST_CONNECTED_ACCOUNT, 'Destination charge configuration mismatch');
      event = await eventFor(data.sessionId, 'checkout.session.completed');
      assertLifecycle(order, ['order_created', 'stripe_session_attached', 'payment_fulfilled', 'email_enqueued'], event);
      const page = await openBuyer(data.email);
      await page.goto(`${baseURL}/tickets`);
      assert(await page.getByText(data.organisationId, {exact: true}).count() > 0, 'Purchased event missing from buyer tickets');
    } else {
      const before = await orderState(data.orderId);
      assert(before.status === 'pending' && before.tickets.length === 0 && before.emailOutboxJobs.length === 0, 'Unpaid checkout fulfilled unexpectedly');
      if (scenario === 'decline') {
        const session = await stripe.checkout.sessions.retrieve(data.sessionId, {expand: ['payment_intent']});
        assert(typeof session.payment_intent === 'object' && session.payment_intent?.last_payment_error, 'No real declined payment evidence');
      }
      await stripe.checkout.sessions.expire(data.sessionId);
      const order = await poll(async () => {const item = await orderState(data.orderId); return item.status === 'expired' ? item : null;});
      assert(order.reservation?.status === 'expired' && order.tickets.length === 0 && order.emailOutboxJobs.length === 0, 'Expiry mismatch');
      assert((await db.ticketType.findUniqueOrThrow({where: {id: data.ticketTypeId}})).quantity === 5, 'Unpaid checkout decremented inventory');
      event = await eventFor(data.sessionId, 'checkout.session.expired');
      assertLifecycle(order, ['order_created', 'stripe_session_attached', 'order_expired'], event);
    }
    await writeFile(`/app/test-results/payment-${scenario}.json`, JSON.stringify({scenario, sessionId: data.sessionId, eventId: event.id, apiVersion: event.api_version, verifiedAt: new Date().toISOString(), passed: true}));
  } else if (action === 'cleanup') {
    for (const name of ['success', 'decline', 'cancel']) {
      let data;
      try {data = JSON.parse(await readFile(statePath(name), 'utf8'));} catch (error) {if (error.code === 'ENOENT') continue; throw error;}
      assert(data.organisationId === ownedOrg(name), 'Cleanup ownership mismatch');
      if (data.sessionId) {
        const known = await stripe.checkout.sessions.retrieve(data.sessionId);
        assert(!known.livemode && known.metadata?.organisationId === ownedOrg(name) && known.metadata?.orderId === data.orderId, 'Known Session ownership mismatch');
        if (known.status === 'open') await stripe.checkout.sessions.expire(known.id);
      }
      // Bounded recovery also finds Sessions created before order.stripeSessionId persisted.
      let startingAfter;
      let exhausted = false;
      for (let page = 0; page < 10; page++) {
        const sessions = await stripe.checkout.sessions.list({created: {gte: data.createdAt}, limit: 100, ...(startingAfter ? {starting_after: startingAfter} : {})});
        for (const session of sessions.data) {
          if (session.metadata?.organisationId !== ownedOrg(name)) continue;
          assert(!session.livemode, 'Live Session cleanup refused');
          const order = await db.order.findUnique({where: {id: session.metadata.orderId}});
          assert(order?.organisationId === ownedOrg(name) && order.eventId === session.metadata.eventId && order.ticketTypeId === session.metadata.ticketTypeId, 'Session cleanup metadata mismatch');
          if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
        }
        if (!sessions.has_more) {exhausted = true; break;}
        startingAfter = sessions.data.at(-1).id;
      }
      assert(exhausted, 'Recovery lookup exceeded safety bound; retain manifest for manual recovery');
      await unlink(statePath(name));
    }
    await unlink('/app/test-results/private-identity.json');
  } else assert(action === 'preflight', 'Unknown staging action');
} catch (error) {
  // Provider errors can include request details: expose only known validation messages.
  console.error(error instanceof Stripe.errors.StripeError ? `Stripe request failed: ${error.type}` : error.message.replace(/(?:sk_test_|whsec_)[A-Za-z0-9]+/g, '[redacted]'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await db.$disconnect();
}
