import Stripe from 'stripe';
import { test, expect, prisma } from './fixtures';
import { createOrder, createReservation } from '@/tests/helpers/test-data';

const stripe = new Stripe('sk_test_synthetic');
const secret = 'whsec_p216_synthetic';

async function pending(data: Awaited<ReturnType<typeof import('./fixtures').seed>>) {
  const order = await createOrder({organisationId: data.organisation.id, eventId: data.event.id, ticketTypeId: data.ticket.id, userId: data.member.id, quantity: 2});
  await createReservation({orderId: order.id, organisationId: data.organisation.id, eventId: data.event.id, ticketTypeId: data.ticket.id, userId: data.member.id, quantity: 2, expiresAt: new Date(Date.now() + 30 * 60000)});
  const session = {id: order.stripeSessionId, object: 'checkout.session', payment_status: 'paid', amount_total: 2400, currency: 'aud', metadata: {orderId: order.id, organisationId: data.organisation.id, eventId: data.event.id, ticketTypeId: data.ticket.id, quantity: '2'}};
  return {order, session};
}

function payload(object: unknown, type = 'checkout.session.completed') {
  return JSON.stringify({id: `evt_${crypto.randomUUID()}`, object: 'event', type, livemode: false, data: {object}});
}

async function state(id: string) {
  return prisma.order.findUniqueOrThrow({where: {id}, include: {tickets: true, reservation: true, emailOutboxJobs: true}});
}

test('signature transport, success-page isolation and concurrent replay fulfil exactly once', async ({ request, data }) => {
  const {order, session} = await pending(data);
  const body = payload(session);
  const header = stripe.webhooks.generateTestHeaderString({payload: body, secret});
  const before = await state(order.id);
  const send = (text: string, signature?: string) => request.post('/api/payments/webhook', {headers: {'content-type': 'application/json', ...(signature ? {'stripe-signature': signature} : {})}, data: text});
  for (const [text, signature] of [[body, undefined], [body, 'invalid'], [body + ' ', header], [body, stripe.webhooks.generateTestHeaderString({payload: body, secret, timestamp: 1})]]) {
    expect((await send(text!, signature)).status()).toBe(400);
    expect(await state(order.id)).toEqual(before);
  }
  await request.get(`/success?session_id=${order.stripeSessionId}`);
  expect(await state(order.id)).toEqual(before);
  const responses = await Promise.all([send(body, header), send(body, header)]);
  for (const response of responses) expect(response.status()).toBe(200);
  const paid = await state(order.id);
  expect(paid.status).toBe('paid');
  expect(paid.reservation?.status).toBe('confirmed');
  expect(paid.tickets).toHaveLength(2);
  expect(paid.emailOutboxJobs).toHaveLength(1);
  expect((await prisma.ticketType.findUniqueOrThrow({where: {id: data.ticket.id}})).quantity).toBe(8);
  expect((await send(body, header)).status()).toBe(200);
  const expired = payload(session, 'checkout.session.expired');
  await send(expired, stripe.webhooks.generateTestHeaderString({payload: expired, secret}));
  expect(await state(order.id)).toEqual(paid);
});

test('real HTTP expiry releases pending inventory and unknown event does not mutate', async ({ request, data }) => {
  const {order, session} = await pending(data);
  const before = await state(order.id);
  for (const type of ['unhandled.event', 'checkout.session.expired']) {
    const body = payload(session, type);
    expect((await request.post('/api/payments/webhook', {data: body, headers: {'stripe-signature': stripe.webhooks.generateTestHeaderString({payload: body, secret})}})).status()).toBe(200);
    if (type === 'unhandled.event') expect(await state(order.id)).toEqual(before);
  }
  const expired = await state(order.id);
  expect(expired.status).toBe('expired');
  expect(expired.reservation?.status).toBe('expired');
  const expiryHistory = await prisma.orderLifecycleEvent.findMany({where: {orderId: order.id, type: 'order_expired'}});
  expect(expiryHistory).toHaveLength(1);
  expect(expiryHistory[0].stripeEventId).toMatch(/^evt_/);
  expect(expired.tickets).toHaveLength(0);
  expect((await prisma.ticketType.findUniqueOrThrow({where: {id: data.ticket.id}})).quantity).toBe(10);
});

for (const mismatch of ['amount', 'currency', 'metadata']) {
  test(`signed ${mismatch} mismatch requires review without issuing tickets`, async ({request, data}) => {
    const {order, session} = await pending(data);
    if (mismatch === 'amount') session.amount_total = 1;
    if (mismatch === 'currency') session.currency = 'usd';
    if (mismatch === 'metadata') session.metadata.quantity = '3';
    const body = payload(session);
    expect((await request.post('/api/payments/webhook', {data: body, headers: {'stripe-signature': stripe.webhooks.generateTestHeaderString({payload: body, secret})}})).status()).toBe(200);
    const result = await state(order.id);
    expect(result.requiresCompensationReview).toBe(true);
    expect(result.tickets).toHaveLength(0);
    expect(result.emailOutboxJobs).toHaveLength(0);
    expect((await prisma.ticketType.findUniqueOrThrow({where: {id: data.ticket.id}})).quantity).toBe(10);
  });
}

test('Connect verifies its own secret and updates only a matching account', async ({request, data}) => {
  const accountId = `acct_${data.organisation.id}`;
  await prisma.organisation.update({where: {id: data.organisation.id}, data: {stripeAccountId: accountId}});
  const account = {id: accountId, object: 'account', details_submitted: true, charges_enabled: true, payouts_enabled: true, requirements: {currently_due: [], eventually_due: []}};
  const body = payload(account, 'account.updated');
  const send = (text: string, signature: string) => request.post('/api/stripe/connect/webhook', {data: text, headers: {'stripe-signature': signature}});
  for (const signature of ['invalid', stripe.webhooks.generateTestHeaderString({payload: body, secret})]) expect((await send(body, signature)).status()).toBe(400);
  expect((await prisma.organisation.findUniqueOrThrow({where: {id: data.organisation.id}})).stripeChargesEnabled).toBe(false);
  expect((await send(body, stripe.webhooks.generateTestHeaderString({payload: body, secret: 'whsec_p216_connect'}))).status()).toBe(200);
  const ready = await prisma.organisation.findUniqueOrThrow({where: {id: data.organisation.id}});
  expect(ready.stripeChargesEnabled).toBe(true);
  const unknown = payload({...account, id: 'acct_unknown'}, 'account.updated');
  expect((await send(unknown, stripe.webhooks.generateTestHeaderString({payload: unknown, secret: 'whsec_p216_connect'}))).status()).toBe(200);
  expect(await prisma.organisation.findUniqueOrThrow({where: {id: data.organisation.id}})).toEqual(ready);
});
