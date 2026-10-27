---
status: living
last-reviewed: 2026-10-27
owner: engineering
related: ["[[Payment Lifecycle]]", "[[E2E and Staging Payments]]", "[[Production Operations]]", "[[Troubleshooting]]"]
sources: [lib/stripe/index.ts, lib/stripe/version.ts, lib/stripe/connect.ts, lib/stripe/fees.ts, lib/stripe/http.ts, lib/payouts/payouts.ts, lib/payouts/release.ts, lib/payments/checkout-creation.ts, lib/commerce/checkout.ts, app/api/payments/webhook/route.ts, app/api/stripe/connect/webhook/route.ts]
---

# Stripe Payments and Connect

**Owns:** the Stripe integration: the client and API version pin, society Connect accounts (create, onboard, status, Express dashboard, disconnect), payouts after the event, Checkout Session parameters, platform fees, both webhook endpoints and every event they handle, and the local Stripe CLI flow.
**Read when:** changing anything that calls Stripe or receives its events, the Payments settings page, fees, payouts, or webhook subscriptions.
**Not here:** what happens to orders, holds, refunds and disputes once an event arrives ([[Payment Lifecycle]]); guard order and rate-limit numbers ([[Route Security Inventory]]); hosted webhook endpoint setup and alert routing ([[Production Operations]]); live symptoms such as signature failures ([[Troubleshooting]]); real test-mode campaigns ([[E2E and Staging Payments]]).

## Code

| Concern | Where |
| --- | --- |
| Client, live-key fence, webhook secrets | `lib/stripe/index.ts`: `getStripe`, `isLiveStripeKey`, `getStripeWebhookSecret`, `getStripeConnectWebhookSecret`, `StripeConfigurationError` |
| API version pin and mismatch alert | `lib/stripe/version.ts`: `stripeApiVersion`, `warnOnVersionMismatch` |
| Connect accounts, status, dashboard link, disconnect | `lib/stripe/connect.ts` |
| Connect error to HTTP mapping | `lib/stripe/http.ts`: `connectRouteRules` |
| Connect request bodies | `lib/validators/stripe-connect.ts`: `organisationConnectSchema`, `stripeDisconnectSchema` |
| Payout worker, payout events, Payments page summary | `lib/payouts/payouts.ts`: `processPayoutBatch`, `reconcilePayoutEvent`, `payoutSummary` |
| Money held back from payouts | `lib/payouts/release.ts`: `heldMoney` |
| Fees and the paid-price minimum | `lib/stripe/fees.ts` |
| Ticket Checkout Session | `lib/payments/checkout-creation.ts`: `createEventCheckout` |
| Commerce Checkout Session | `lib/commerce/checkout.ts`: `createCommerceCheckout` |
| Session expiry, integration ids, definite-failure test | `lib/payments/checkout-attempts.ts` |
| Payment destination read before fulfilment | `lib/payments/checkout-fulfilment-orchestrator.ts` |
| Webhook endpoints | `app/api/payments/webhook/route.ts`, `app/api/stripe/connect/webhook/route.ts` |
| Development success fallback | `app/success/page.tsx` |
| UI | `components/settings/stripe-connect-settings.tsx`, `components/settings/payouts-card.tsx` on `/dashboard/settings` |
| Tests | `tests/integration/stripe-connect-service.test.ts`, `tests/integration/connect-safety.test.ts`, `tests/integration/stripe-dashboard-link.test.ts`, `tests/integration/society-payouts.test.ts`, `tests/integration/payments-webhook.test.ts`, `tests/e2e/webhooks.spec.ts` |

## Client and API version

- `getStripe()` throws `StripeConfigurationError` when `STRIPE_SECRET_KEY` is missing, and refuses a live key (`sk_live_` or `rk_live_`) unless `NODE_ENV` is `production`.
- Every client speaks `stripeApiVersion` (`lib/stripe/version.ts`), the version the `stripe` package in `package.json` is typed for (PAY-006). Hosted webhook endpoints and the staging listener are created on the same version.
- Moving the pin needs a fresh test-mode campaign ([[E2E and Staging Payments]]) and webhook endpoints recreated on the new version ([[Production Operations]]).
- Currency is `aud` everywhere. Charges are destination charges with `on_behalf_of`: the society is the settlement merchant, Thunderstrux takes `application_fee_amount`.

## Connect accounts

Each society has at most one Express account, stored on `Organisation`: `stripeAccountId`, `stripeAccountStatus`, `stripeChargesEnabled`, `stripePayoutsEnabled`, `stripeDetailsSubmitted`.

| Route | Does | Notable answers |
| --- | --- | --- |
| `POST /api/stripe/connect/onboard` | `startOrganisationStripeOnboarding`: create the account if none, then return an onboarding link `{ url }` | 409 `{ state, message, actionRequired, actionUrl }` when the platform isn't ready |
| `POST /api/stripe/connect/continue` | `continueOrganisationStripeOnboarding`: a fresh onboarding link | 400 when no account is connected |
| `GET /api/stripe/connect/status?organisationId=` | `getOrganisationStripeConnectStatus`: read Stripe, persist the flags, return the status | 503 when Stripe isn't configured |
| `POST /api/stripe/connect/dashboard` | `createOrganisationDashboardLink`: a single-use Express Dashboard login link `{ url }` | 400 until details are submitted |
| `POST /api/stripe/connect/disconnect` | `disconnectAccount`, then `{ disconnected: true, status }` with `NOT_CONNECTED` | 409 while orders depend on the account or sale money is still held |

- **Authority:** every route needs `stripe:manage` on the target society (`requireStripeConnectCapability`, then `requireOrganisationStripeConnectAccess`). The body or query names `organisationId`; it is authorised, never trusted ([[Authentication and Dashboard Access#Roles and permissions]]).
- **Guards:** the four POSTs check the trusted origin and rate limit `stripe_connect_mutation` per society and action, and apply `staff_mfa_verify` per user when a code is sent ([[Route Security Inventory#Rate limits]]).
- **Errors** (`connectRouteRules`): a missing or unreachable society is 404, permission is 403, a bad `organisationId` is 400, `MfaRequiredError` 403, a bad code 400, MFA misconfiguration 503, `StripeConfigurationError` 503 "Stripe is not configured." (no server setting named), and a disconnect Stripe couldn't answer 503 (`StripeDisconnectUnavailableError`). Provider messages never reach the client.
- **Account creation** (`createExpressAccount`): `type: "express"`, capabilities `card_payments` (needed by `on_behalf_of`) and `transfers` (destination charges), and `settings: manualPayoutSettings` (see Payouts). The idempotency key is `connect-account:<orgId>:<n>`, where `n` counts earlier `stripe_connect.account_created` audit rows: a double click returns the same account, a reconnect after disconnect gets a new one. Success stores the id with `CONNECTED_INCOMPLETE` and all flags false, and writes `stripe_connect.account_created`.
- **Onboarding links:** `accountLinks.create` (`account_onboarding`); return and refresh URLs are `/dashboard/settings` on the trusted origin the request came from, else the app URL. Onboarding collects the bank account payouts go to, so `onboard` and `continue` need a fresh authenticator code unless staff MFA is `off` (`mfaCode` in the body, as the dashboard link).
- **Status:** with an account, the response adds `openObligations` (orders that block disconnect) and `payouts` (`payoutSummary`). `dashboard_available` is `details_submitted`.
- **Express dashboard:** needs a fresh authenticator code unless staff MFA is `off`, because the dashboard can change where payouts go. It calls `accounts.createLoginLink` per click and writes `stripe_connect.dashboard_opened`. The platform's own view (`dashboard.stripe.com/connect/accounts/...`) never opens for a society.
- **Disconnect:** a fresh authenticator code unless MFA is `off`. Open obligations are counted first, then held money: while `heldMoney` is above zero, the account is kept on manual payouts (`keepStripePayoutsManual`) and disconnect is refused (`heldMoneyBlocksDisconnect`), because Stripe's daily schedule would pay out money the society may still have to refund (PAY-018). An account out of reach is still unlinked, since nothing can be paid out of it. If neither blocks, the account goes back to Stripe's daily payouts (`restoreStripePayoutSchedule`). If Stripe answers that this platform's key can't see the account (a 403 `StripePermissionError`: made under another platform key, or deleted), there's no schedule to give back and the account is unlinked anyway, logged `stripe_connect.disconnect_account_out_of_reach` (PAY-015); any other Stripe failure is a 503 and nothing changes. Then, under the `Organisation` row lock, they are counted again. The local Stripe fields are cleared and `stripe_connect.disconnected` records the previous account id. With no account (for example `PLATFORM_NOT_READY`) only the local state resets. The Stripe account is never deleted, and past orders keep it as their seller snapshot.
- **Open obligations** are Stripe orders for the account, or orders with no seller snapshot: ticket orders of the society's events and commerce orders of the society. One counts while it is `pending`, under compensation review, `refundStatus = processing`, `disputeStatus = open`, or has a `RefundRequest` that is `pending` or `uncertain`. Ticket orders also count while their `CompensationRefundJob` is `review_required`, `auto_queued`, `auto_processing`, `refund_pending` or `refund_failed`.

## Connect account states

`StripeConnectState` in `lib/stripe/connect.ts`, stored as `Organisation.stripeAccountStatus`:

| State | Meaning | Settings action |
| --- | --- | --- |
| `NOT_CONNECTED` | No `stripeAccountId` | Connect Stripe |
| `PLATFORM_NOT_READY` | No account; Stripe refused to create one because the platform's Connect profile is unfinished (detected from the error's message only; a network failure, `StripeConnectionError`, is rethrown and changes nothing) | Open Stripe Platform Settings (`stripePlatformProfileUrl`), Retry after completion, Disconnect |
| `CONNECTED_INCOMPLETE` | `details_submitted` is false | Continue Stripe setup |
| `RESTRICTED` | Details submitted, `charges_enabled` false | Fix in Stripe |
| `READY` | `charges_enabled` true | Add a bank account in Stripe while `payouts_enabled` is false (badge "Payouts not set up") |
| `ERROR` | The last refresh couldn't reach Stripe. Flags keep their last values; the response says Thunderstrux couldn't reach Stripe and the provider message stays in the log | Try again |

- Settings shows two rows, **Can take payments** (charges) and **Can receive payouts** (payouts), so a society with no bank account keeps selling.
- **Selling depends on flags, not the state:** `isOrganisationStripeReady` is `stripeAccountId && stripeChargesEnabled`. In `ERROR` sales follow the last known flags until a refresh succeeds.
- **The `account.updated` webhook** re-reads the account (`refreshConnectedAccount`) for an account some society uses, and persists the same flags and state. An account no society uses logs `stripe_connect.webhook.ignored` (`stripe_account_not_found`) without calling Stripe.
- **One write path:** the webhook and a Settings refresh both save through `persistConnectedAccountStatus`, which reads the previous flags under the society's row lock, so two saves at once email a transition once. A refresh that read Stripe before a newer webhook can still save the older flags afterwards (as before), and the next correction may email again. In the same transaction it emails (`business_notice`, linked to `/dashboard/<slug>/settings`, which opens that society) every active staff member whose role has `stripe:manage`:
  - when card payments go from on to off (key `stripe-charges-paused/<orgId>/<time>`), and alerts `society_charges_paused` after commit;
  - while card payments are on, once per deadline Stripe sets for `currently_due` details (`requirements.current_deadline`; key `stripe-deadline/<orgId>/<deadline>`, which the outbox keeps once). The deadline may pause card payments or payouts.

  An email that can't be queued (for example no `EMAIL_FROM`) logs `stripe_connect.notice_not_queued` and never undoes the flags.
- **Ready with details due:** Settings shows "Stripe needs more details", the deadline when there is one (`current_deadline` in the status), what Stripe needs, and "Update details in Stripe" (a fresh onboarding link). The badge reads "Needs details".

## Payouts

Societies are paid after their event, as Humanitix and Eventbrite pay organisers, so refunds for a cancelled event come from money the society still holds (PAY-005). On destination charges the platform carries negative balances, so this protects Thunderstrux too.

- **Manual payouts:** new accounts get `manualPayoutSettings`: `payouts.schedule.interval = manual` and `debit_negative_balances = true`, so a refund after a payout is debited from the society's bank, not left to Thunderstrux. Older accounts are switched the first time the worker checks them.
- **Worker:** `processPayoutBatch` is the fourth batch of the refunds worker (`scripts/process-compensation-refunds.ts`, `pnpm compensation-refunds:process`). It takes societies with an account and `stripePayoutsEnabled`, whatever the state (a failed refresh, `ERROR`, or paused card payments, `RESTRICTED`, doesn't stop money the society is owed), at most once an hour each, claimed by compare-and-set on `Organisation.payoutCheckedAt`. Per society it:
  1. makes sure the account is on manual payouts;
  2. skips the society if a `SocietyPayout` for that account already exists this UTC day (DEF-034);
  3. reads the available AUD balance and subtracts `heldMoney`;
  4. if at least `minPayout` (100 cents) is left, creates one payout on the connected account, key `payout:<account>:<UTC date>`, and records a `SocietyPayout`.

  So a society gets at most one payout a UTC day, and money released later in the day goes the next day. A payout never exceeds the available balance, so a retry can't overpay. A failure logs `payouts.failed_to_send` and is retried next hour; a payout Stripe made despite the error arrives through its webhook.
- **Held money** (`heldMoney`, `lib/payouts/release.ts`) counts paid Stripe sales to that account (by seller snapshot) with `refundStatus` null or `processing`, paid within `maxHoldMs` (80 days; Stripe holds manual-payout money at most 90 days in Australia):

  | Sale | Held while |
  | --- | --- |
  | Ticket order of the society's event | until `ticketHoldAfterEventMs` (2 days) after the event ends, or after the latest end it had (`EventChange.previousEndTime`), whichever is later, so moving the end earlier can't release it (SEC-029) |
  | Membership or merchandise order | `commerceHoldMs` (7 days) after payment |
  | Any of them | while `disputeStatus = open`, under compensation review, or a dispute reversal is `pending` or `uncertain` |

  Each sale holds its society share: total less `feeAmount` less `externalRefundedAmount`. Money already back with the buyer holds nothing: ticket orders refunded by compensation (`isManuallyRefunded` with a `CompensationRefundJob`), and lost disputes whose transfer reversal succeeded. A staff "refunded outside Thunderstrux" mark proves nothing at Stripe, so that sale waits for its event like any other (PAY-016).
- **Payout events:** the Connect webhook passes `payout.paid`, `payout.failed`, `payout.canceled` and `payout.updated` to `reconcilePayoutEvent`. It re-reads the payout on the connected account and records `SocietyPayoutStatus`: `paid`, `failed` (failed or canceled) or `pending`. A first move to `failed` alerts `society_payout_failed`. A payout with no known society, or recorded under another account, logs `payouts.webhook.ignored` and changes nothing.
- **Payments page:** the payouts card shows money waiting for events (amount, event count, next event end), commerce money from the last 7 days, what is on its way (pending payouts), and the last 5 payouts. A refused payout shows a warning until a later payout is paid. Every payout opens in the Express dashboard.
- **Disconnect** is refused while any money is held; once nothing is, it restores Stripe's daily schedule. If disconnect is then refused under the lock, the next worker check puts the account back on manual payouts.
- **Not built:** early payouts and a per-payout breakdown of orders. A payout is the balance less what is held, not a set of orders.

## Checkout Sessions

Both flows build the request, store it on `CheckoutAttempt.providerRequest`, then call `checkout.sessions.create` outside any transaction with the attempt's `providerOperationKey` (`checkout_<uuid>`) as the idempotency key. Recovery replays the stored request with the same key ([[Payment Lifecycle]]).

| Parameter | Tickets (`createEventCheckout`) | Memberships and merchandise (`createCommerceCheckout`) |
| --- | --- | --- |
| `mode` | `payment` | `payment` |
| `allowed_payment_method_types` | `["card"]` | `["card"]` |
| `integration_identifier` | `checkoutIntegrationIdentifiers.tickets` | `checkoutIntegrationIdentifiers.commerce` |
| `customer_email` | buyer snapshot | buyer snapshot |
| `line_items` | one line: event title, quoted unit price (member price when one applied), quantity | one per paid line, named `name (variant)`; free lines are left off |
| `payment_intent_data` | `application_fee_amount`, `on_behalf_of` and `transfer_data.destination` = the society's account, metadata | same |
| `metadata` (Session and PaymentIntent) | `orderId`, `eventId`, `organisationId`, `ticketTypeId`, `quantity` | `family`, `commerceOrderId`, `organisationId` |
| `success_url` | member: `/success?session_id={CHECKOUT_SESSION_ID}`; guest: `/guest/orders/{orderId}` | `/memberships/orders/{id}` or `/merchandise/orders/{id}` |
| `cancel_url` | `/cancel?order={orderId}` | the same order page with `?left=1` |
| `expires_at` | `checkoutSessionExpiresAt()`: now + 30 minutes + 60 seconds | same |

- URLs use the trusted origin the buyer bought from, else `getAppUrl()`. A guest's order page opens only with their session cookie, and the cancel page names the order only to its buyer.
- **Card only:** a completed Session is then paid at once, so fulfilment needs no async payment events. API version `2026-09-30.endive` removed `payment_method_types`.
- **Expiry:** Stripe refuses an `expires_at` under 30 minutes after creation. The 60-second margin covers the trip to Stripe and stays under the 2-minute recovery delay, so replaying a request Stripe never saw is refused and the hold is released.
- **Errors:** a definite Stripe refusal (`isDefiniteProviderFailure`: card, invalid request, authentication, permission or rate-limit error) fails the order. Any other error leaves the attempt `provider_uncertain`, alerts `checkout_session_creation_failure` and answers 202. A Session without a `url` fails the order (`missing_redirect_url`). Ticket checkout also logs `checkout.session.create_started`, `checkout.session.created` and `checkout.session.create_failed`, with metric `checkout_session_create_failures_total`.

## Fees

`lib/stripe/fees.ts`, decided at checkout and recorded on the order (`feeAmount`, `feePolicyVersion`):

- `calculatePlatformFee(totalAmount, items)`: `PLATFORM_FEE_RATE` (3.75%) of the order, rounded once, plus `PLATFORM_FEE_PER_ITEM` (89 cents) per ticket, never more than the total. A membership or merchandise order is one item (T46).
- `PLATFORM_FEE_POLICY_VERSION` is `platform_fee_3_75_percent_89c_v2`. Older orders carry `platform_fee_10_percent_v1`. Bump it whenever the rate or rounding changes.
- The fee includes card processing, which Stripe charges the platform on destination charges. The society absorbs the fee, so buyers pay the price shown. On a $20.00 ticket the society receives $18.36 and Thunderstrux keeps $1.64.
- Refunds return the fee (`refund_application_fee`) while Stripe keeps its processing fee (PAY-008, accepted risk).
- Paid prices start at `minPaidPrice` (50 cents, Stripe's smallest AUD card payment). Prices are 0 or at least 50 cents (`priceAmountSchema` in `lib/validators/price.ts`, `isBelowStripeMinimum`).

## Required conditions for checkout

Ticket checkout checks, under the buyer, event and ticket type locks ([[Payment Lifecycle]]); the `reason` in each 4xx detail is the kind:

| Condition | Refusal |
| --- | --- |
| A verified member account (organisation accounts get 400), or a live guest checkout session with its CSRF token | 401/403 |
| The event exists; a members-only event needs the buyer's `members_only_events` entitlement | 404 `event_not_found` |
| Event `published` | 400 `event_draft` |
| Sales open | 400 `sales_closed` |
| Ticket type belongs to the event | 404 `ticket_type_not_found` |
| Sellable stock (`sellableQuantity`) | 400 `sold_out`, 400 `insufficient_availability` |
| A paid price needs `isOrganisationStripeReady` | 400 `stripe_not_ready` ("Stripe not connected"; the detail says whether there is no account or charges are disabled) |
| `expectedUnitPrice` equals the locked price | 409 `quote_changed` |
| Paid only: the buyer's live holds on the event plus this quantity stay within `maxTicketsPerOrder` (10), a member by account and a guest by identity (SEC-005) | 409 `purchase_in_progress` |
| Same idempotency key, different selection | 409 `idempotency_conflict` |
| `STRIPE_SECRET_KEY` configured | 503 "Payments are unavailable right now" |

A free price completes without reading any Stripe configuration. Commerce checkout needs `isOrganisationStripeReady` only for a paid total (`stripe_not_ready`).

## Webhooks

| Endpoint | Secret | Events handled |
| --- | --- | --- |
| `POST /api/payments/webhook` | `STRIPE_WEBHOOK_SECRET` | `checkout.session.completed`, `checkout.session.expired`, `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed` |
| `POST /api/stripe/connect/webhook` | `STRIPE_CONNECT_WEBHOOK_SECRET` | `account.updated`, `payout.paid`, `payout.failed`, `payout.canceled`, `payout.updated` |

Both endpoints run the same checks, in order:

1. No `stripe-signature` header: 400, log `stripe.webhook.signature_failed` (`stripe_connect.webhook.signature_failed` on Connect), metric `stripe_webhook_signature_failures_total`, alert `stripe_webhook_signature_failure`.
2. Read the raw body with `request.text()`. A missing key or secret is 503, log `stripe.webhook.configuration_error` (`stripe_connect.webhook.configuration_error`).
3. `webhooks.constructEvent` fails: 400 with the same log, metric and alert.
4. Log `stripe.webhook.received` (`stripe_connect.webhook.received`) with event id, type and `api_version`.
5. `warnOnVersionMismatch`: an event on another API version logs `stripe.webhook.version_mismatch` and alerts `stripe_webhook_version_mismatch` (deduplicated per endpoint), then is still handled. Replace that endpoint.
6. `event.livemode` differs from the key's mode: 200 `{ received: true, ignored: "mode_mismatch" }`, log `stripe.webhook.mode_mismatch`, alert `stripe_webhook_mode_mismatch`, nothing changes.
7. Route the event (below). An unhandled type answers 200 (payments logs `stripe.webhook.ignored`). A handler error answers 500, so Stripe retries.

Payments routing:

| Event | Goes to |
| --- | --- |
| `checkout.session.*` whose Session `metadata.family` is set | `reconcileCommerceCheckoutSession` or `reconcileExpiredCommerceSession` (`lib/commerce/reconciliation.ts`) |
| `checkout.session.*` without `family` whose Session belongs to a `CommerceOrder` | ignored: log `commerce.webhook.ignored`, alert `commerce_webhook_identity_mismatch` (`commerce_session_without_family`) |
| `checkout.session.completed` (ticket) | `reconcileCompletedCheckoutSessionWithSideEffects`: reads the PaymentIntent's `transfer_data.destination` from Stripe before any lock, then fulfils |
| `checkout.session.expired` (ticket) | `reconcileExpiredCheckoutSession` |
| `refund.*` with `metadata.refundRequestId` | `reconcileOrderRefundEvent` (`lib/payments/order-refunds.ts`) |
| `refund.*` with `metadata.compensationRefundJobId` | `reconcileRefundEvent` (`lib/payments/compensation-refunds.ts`) |
| any other `refund.*` (made outside Thunderstrux) | `reconcileCommerceExternalRefundEvent`, else `reconcileExternalRefundEvent` |
| `charge.dispute.*` | `reconcileCommerceDisputeEvent`, else `reconcileDisputeEvent` |

What each handler does to orders, and its checks (amount, currency, metadata, destination, the order's bound Session), is in [[Payment Lifecycle]]. Identity alerts raised there: `payment_reconciliation_ambiguous_order`, `ticket_webhook_identity_mismatch` (a paid Session that isn't the order's, PAY-010), `commerce_webhook_identity_mismatch`, `purchase_dispute_unmatched`, `paid_but_unfulfilled_compensation_required`.

**Idempotency.** Stripe may deliver twice and out of order.
- Checkout events are idempotent through order state under row locks.
- Refund and dispute events are journalled once by event id in `StripeRefundWebhookEvent`, and project Stripe's current state as re-read.
- `account.updated` and `payout.*` re-read the object from Stripe, so a late event can't restore an older state.
- Every order transition stores `stripeEventId` in the order history.

Handlers do their work before answering 2xx (PAY-007, accepted risk). The hosted endpoints must subscribe to every event above ([[Production Operations]]); refund and dispute subscription is part of the PAY-002 gate.

**Development fallback.** Outside production, `/success?session_id=` retrieves the Session and, if it is paid, runs the same fulfilment (`dev_success_fallback`), because Stripe redirects there even without local webhook forwarding. In production the page only shows the order's real state, and only to its buyer.

## Local Stripe CLI

Use test-mode keys in `.env`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` ([[Environment Variables]]). Then:

```bash
stripe login
stripe listen --latest \
  --events checkout.session.completed,checkout.session.expired,refund.created,refund.updated,refund.failed,charge.dispute.created,charge.dispute.updated,charge.dispute.closed,account.updated,payout.paid,payout.failed,payout.canceled,payout.updated \
  --forward-to localhost:3000/api/payments/webhook \
  --forward-connect-to localhost:3000/api/stripe/connect/webhook
```

- Put the printed `whsec_...` in both webhook secrets; it belongs to this listener only, not to a Dashboard endpoint. `--latest` sends events on the pinned version; without it events use the account's default version and raise `stripe_webhook_version_mismatch`.
- `.env` changes need `pnpm docker:restart` (it recreates the app; a plain restart keeps old env). Check the loaded secret without printing it: `docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app node -e "const s=process.env.STRIPE_WEBHOOK_SECRET; console.log(s ? s.slice(0,12)+'... len='+s.length : 'missing')"`.
- **End to end:** connect a test Express account until it can take payments, buy from a published event's checkout button, then check `/tickets`, `/dashboard/orders` and the ticket type's remaining stock. A paid checkout logs `stripe.webhook.received`, then "Stripe checkout order matched", "Stripe checkout reconciliation validation passed", "Stripe checkout inventory updated" and "Stripe checkout tickets created".
- `stripe trigger checkout.session.completed` only tests signature plumbing: its Session has none of this app's metadata, so reconciliation logs order not found and changes nothing.
- **Duplicate delivery:** `stripe events resend evt_... --webhook-endpoint=we_...` against a registered test endpoint. Triggering twice makes two different events. A replay must leave one paid order, `quantity` tickets and one stock decrement.
- Logs: `stripe logs tail` and `docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f app`.

## Traps

- Never mark an order paid from a browser redirect. Only a signed webhook fulfils in production.
- Adding a non-card payment method first needs `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed` handling, because ticket fulfilment requires `payment_status = paid`.
- Never put `family` in ticket Session metadata: it routes the event to commerce.
- Checkout readiness is the charges flag, not `READY`. Don't gate selling on the state.
- A fee change without a new `PLATFORM_FEE_POLICY_VERSION` makes old and new orders indistinguishable.
- A new handled event type must also be subscribed on the hosted endpoint and added to the staging listener's `--events`.
- Destination charges need the society's account to keep `transfers` and `card_payments`; Express creation requests both.

## Failure and recovery

- **`PLATFORM_NOT_READY`:** finish the platform's Connect profile in Stripe, then Retry after completion.
- **`ERROR`:** Stripe was unreachable; Try again. Sales follow the last flags meanwhile.
- **Disconnect refused:** the page shows how many orders are open, or how much sale money is still held; wait for them to finish or for the money to be paid out.
- **Reconnect a previously disconnected account** (disconnect never deletes it): set it back, then Refresh status on `/dashboard/settings`.

  ```sql
  UPDATE "Organisation" SET "stripeAccountId" = 'acct_...', "stripeAccountStatus" = 'CONNECTED_INCOMPLETE',
    "stripeChargesEnabled" = false, "stripePayoutsEnabled" = false, "stripeDetailsSubmitted" = false
  WHERE "slug" = '<society-slug>';
  ```
- **`society_payout_failed`:** the society fixes its bank details in the Express dashboard. The next hourly check pays the balance once the UTC day has no payout.
- **`society_charges_paused`:** the society's Stripe managers were emailed; they send what Stripe asks for from Payments ("Fix in Stripe").
- **Sales held more than 80 days** are released before a long-lead event; if it is cancelled, `event_cancelled_after_release` alerts (PAY-022, [[Event Lifecycle#Cancelling]]).
- **Version or mode mismatch alerts:** recreate the endpoint on the pinned version, or fix the key or endpoint pairing ([[Production Operations]]). Signature failures: [[Troubleshooting]].

## Related

[[Payment Lifecycle]] · [[E2E and Staging Payments]] · [[Production Operations]] · [[Route Security Inventory]] · [[Audit Coverage]] · [[Troubleshooting]] · [[Glossary]]
