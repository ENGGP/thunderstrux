# Handover 2026-05-13 - Compensation Review

Read this after [[Current Handover]] and before touching checkout reconciliation again.

## Session Focus

Implemented P0.4 paid-but-unfulfilled compensation review.

Goal:

- When Stripe confirms payment but Thunderstrux cannot locally fulfil tickets, persist a durable operator-review state.
- Do not automatically refund.
- Do not change successful webhook fulfilment.
- Do not change Stripe Checkout flow, reservation lifecycle semantics, email architecture, RBAC, or organiser UI structure.

## Behaviour Now

Successful fulfilment remains:

- Stripe webhook or non-production success fallback calls checkout reconciliation.
- Reconciliation validates local order, amount, currency, metadata, active reservation, and inventory.
- Order becomes `paid`.
- Reservation becomes `confirmed`.
- Inventory decrements once.
- Tickets are created once.
- Automatic ticket email runs only for a newly `fulfilled` result.
- Duplicate completed webhooks for paid orders return `already_paid` and do not issue more tickets or send duplicate email.

Paid-but-unfulfilled behaviour:

- Order becomes `status = failed`.
- `requiresCompensationReview = true`.
- `paidAt` is set or preserved.
- `fulfilmentFailedAt` and `fulfilmentFailureReason` are write-once diagnostics.
- No tickets are issued.
- No ticket email is sent.
- Existing organiser order list/detail surfaces show a minimal warning.
- Member `/tickets` still shows only `paid` orders, so compensation-required failed orders are not valid member tickets.

Retry behaviour:

- Ordinary failed orders remain non-retryable.
- Compensation-required failed orders can retry only if an active unexpired reservation naturally still exists.
- Successful natural retry clears `requiresCompensationReview`, clears ordinary `failedAt`/`failureReason`, preserves fulfilment diagnostics, and fulfils normally.
- Confirmed/released/expired reservations are not restored to active.

## Schema

Migration:

```text
20260512060000_order_compensation_review
```

Fields added to `Order`:

- `requiresCompensationReview Boolean @default(false)`
- `fulfilmentFailedAt DateTime?`
- `fulfilmentFailureReason String?`

No `OrderStatus` enum value was added.

## Tests And Validation

Validation run:

- `pnpm prisma:generate` passed after rerunning with network approval for Prisma engine metadata.
- `pnpm exec tsc --noEmit` passed.
- `git diff --check` passed with CRLF warnings only.
- `docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app pnpm test:integration` passed with 12 files and 76 tests.
- Initial smoke failed because the local Docker database did not yet have the new columns.
- `docker compose exec app pnpm prisma:migrate:deploy` applied the migration.
- `docker compose exec app pnpm test:smoke` passed with 22 checks.

Coverage added or updated:

- Paid amount mismatch marks compensation review and sends no email.
- Inventory mismatch marks compensation review.
- Duplicate compensation webhook preserves write-once diagnostics.
- Natural retry with active reservation clears `requiresCompensationReview` and fulfils normally.
- Already-paid ticket mismatch is logged but not mutated.
- Expired order plus paid completed session requires compensation review.
- Expired/missing reservation plus paid session requires compensation review.
- Compensation-required failed orders are excluded from member ticket results.

## Important Follow-Ups

See [[Non-Blocking Issue Register]].

Highest-value payment follow-ups:

- Add missing required metadata fallback test by `stripeSessionId`.
- Add reservation quantity mismatch compensation test.
- Add explicit non-paid completed-session test proving no compensation review.
- Add real signed Stripe webhook staging/E2E coverage.
- Add durable email outbox.
- Add operator playbook or tooling for compensation-required orders.

## Preserve

- Stripe webhook remains the production source of truth for payment fulfilment.
- Do not mark orders paid from frontend success pages.
- Do not issue tickets for compensation-required orders.
- Do not send ticket emails for compensation-required orders.
- Do not mutate already-paid orders into compensation review.
- Do not restore reservations to active.
- Do not implement automatic refunds until business rules and idempotency are explicitly designed.
