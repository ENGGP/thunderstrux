---
status: living
last-reviewed: 2026-10-28
owner: engineering
related: ["[[Stripe Payments and Connect]]", "[[Payment Lifecycle Refunds and Disputes]]", "[[Production Operations Alerts]]"]
sources: [lib/payouts/payouts.ts, lib/payouts/release.ts, lib/payments/refund-worker.ts, components/settings/payouts-card.tsx]
---

# Stripe Payments and Connect Payouts

**Owns:** paying societies after their event: the payout worker, the money held back and why, payout and payout-account events, and the Payments page's payout view.
**Read when:** changing payouts, the payout hold, or what a society sees about its money.
**Not here:** Connect accounts, Checkout Sessions, fees and webhook endpoints ([[Stripe Payments and Connect]]); refunds and disputes ([[Payment Lifecycle Refunds and Disputes]]); alert actions ([[Production Operations Alerts]]).

## Payouts

Societies are paid after their event, as Humanitix and Eventbrite pay organisers, so refunds for a cancelled event come from money the society still holds (PAY-005). On destination charges the platform carries negative balances, so this protects Thunderstrux too.

- **Manual payouts:** new accounts get `manualPayoutSettings`: `payouts.schedule.interval = manual` and `debit_negative_balances = true`, so a refund after a payout is debited from the society's bank, not left to Thunderstrux. Older accounts are switched the first time the worker checks them.
- **Worker:** `processPayoutBatch` is the fourth batch of the refunds worker (`scripts/process-compensation-refunds.ts`, `pnpm compensation-refunds:process`, through `runRefundWorkerBatches` in `lib/payments/refund-worker.ts`). Each batch runs whatever the others do, so a refund error never skips payouts; the run still fails afterwards and alerts `worker_failed` (PAY-040). It takes societies with an account and `stripePayoutsEnabled`, whatever the state (a failed refresh, `ERROR`, or paused card payments, `RESTRICTED`, doesn't stop money the society is owed), at most once an hour each, claimed by compare-and-set on `Organisation.payoutCheckedAt`. Per society it:
  1. makes sure the account is on manual payouts;
  2. skips the society if a `SocietyPayout` for that account already exists this UTC day (DEF-034);
  3. reads the available AUD balance and subtracts `heldMoney`;
  4. if at least `minPayout` ($20) is left, or `smallPayout` ($1) once the society has had no payout that wasn't refused for `smallPayoutAfterMs` (7 days) or ever, creates one payout on the connected account, key `payout:<account>:<attempt time>`, and records a `SocietyPayout`. Connect charges the platform A$0.25 + 0.25% a payout, so small balances wait.

  So a society gets at most one payout a UTC day, and money released later in the day goes the next day. A payout never exceeds the available balance, so a retry can't overpay. A failure logs `payouts.failed_to_send` and is retried next hour under a new key: Stripe keeps a refusal under its key and refuses that key with another amount, so a per-day key blocked the rest of the day. A payout Stripe made despite the error arrives through its webhook.
- **Held money** (`heldMoney`, `lib/payouts/release.ts`) counts paid Stripe sales to that account (by seller snapshot) with `refundStatus` null or `processing`, paid within `maxHoldMs` (80 days; Stripe holds manual-payout money at most 90 days in Australia):

  | Sale | Held while |
  | --- | --- |
  | Ticket order of the society's event | until `ticketHoldAfterEventMs` (2 days) after the event ends, or after the latest end it ever had (`Event.latestEndTime`, kept by every edit, tickets or not), whichever is later, so moving the end earlier can't release it (SEC-029, SEC-032) |
  | Membership or merchandise order | `commerceHoldMs` (7 days) after payment |
  | Any of them | while `disputeStatus = open`, under compensation review, a dispute reversal is `pending` or `uncertain`, a refund made in Stripe wasn't taken back from the society (`externalUnreversedAmount` > 0, PAY-027), a refund is being sent (`refundStatus = processing` or an open `RefundRequest`, PAY-033), or a bank's inquiry is open (`warning_needs_response` or `warning_under_review`, PAY-037) |

  Each sale holds its society share: total less `feeAmount` less what was refunded outside Thunderstrux and taken back from its transfer (`externalRefundedAmount` − `externalUnreversedAmount`, from Stripe's `amount_refunded` and the transfer's `amount_reversed`, re-read before each payout run), less the society's pro rata part of refunds made here (`floor(refunded × share ÷ total)`, as `reverse_transfer` takes it; DEBT-002). Money already back with the buyer holds nothing: ticket orders refunded by compensation (`isManuallyRefunded` with a `CompensationRefundJob`), and lost disputes whose transfer reversal succeeded. A staff "refunded outside Thunderstrux" mark proves nothing at Stripe, so that sale waits for its event like any other (PAY-016).
- **Payout events:** the Connect webhook passes `payout.created`, `payout.paid`, `payout.failed`, `payout.canceled` and `payout.updated` to `reconcilePayoutEvent`. `payout.created` records a payout Stripe made although the worker saw an error, so the one-a-day check sees it; until it arrives a second attempt can only send what was released since. It re-reads the payout on the connected account and records `SocietyPayoutStatus`: `paid`, `failed` (failed or canceled) or `pending`. A first move to `failed` alerts `society_payout_failed`. A payout's first sighting is whichever delivery inserts its `SocietyPayout` row, so Stripe's simultaneous events alert once (PAY-042). A payout with no known society, or recorded under another account, logs `payouts.webhook.ignored` and changes nothing. One without the worker's `metadata.organisationId` (an Instant Payout, or Stripe's own schedule) alerts `society_payout_unexpected` and goes back to manual payouts (PAY-028).
- **Payout account changes (SEC-033):** `account.external_account.created`, and `.updated` when another account becomes the default, email every `stripe:manage` staff member once per event (`notifyPayoutAccountChanged`) and audit `stripe_connect.payout_account_changed`.
- **Payments page:** the payouts card shows money waiting for events (amount, event count, next event end), commerce money from the last 7 days, what is on its way (pending payouts), and the last 5 payouts. A refused payout shows a warning until a later payout is paid. Every payout opens in the Express dashboard. When Stripe turns payouts off after onboarding (no bank account due), the page says payouts are paused rather than "add a bank account", and Stripe managers are emailed once per pause (`stripe-payouts-paused/{orgId}/{time}`, PAY-041).
- **Disconnect** is refused while any money is held; once nothing is, it restores Stripe's daily schedule. If disconnect is then refused under the lock, the next worker check puts the account back on manual payouts.
- **Not built:** early payouts and a per-payout breakdown of orders. A payout is the balance less what is held, not a set of orders.

## Related

[[Stripe Payments and Connect]] · [[Payment Lifecycle Refunds and Disputes]] · [[Production Operations Alerts]] · [[Pre-hosting Candidate]]
