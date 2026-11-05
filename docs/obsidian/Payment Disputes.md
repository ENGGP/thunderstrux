---
status: living
last-reviewed: 2026-11-05
owner: engineering
related: ["[[Payment Lifecycle Refunds and Disputes]]", "[[Payment Lifecycle]]", "[[Stripe Payments and Connect Payouts]]", "[[Production Operations Alerts]]"]
sources: [lib/payments/purchase-disputes.ts, lib/payments/dispute-outcome.ts, lib/commerce/payment-recovery.ts, lib/payments/dispute-reversals.ts, lib/payments/dispute-evidence.ts]
---

# Payment Disputes

**Owns:** what a Stripe dispute does to a ticket or commerce order, for every move Stripe can make: open, inquiry, appeal, prevented, lost (whole or part), won, won after a loss, and staff restoring tickets.
**Read when:** changing `charge.dispute.*` handling, the dispute fence, restore, or what a dispute does to tickets, memberships, refunds and payouts.
**Not here:** refunds, compensation and lost-dispute transfer reversals ([[Payment Lifecycle Refunds and Disputes]]); the payout share and hold ([[Stripe Payments and Connect Payouts]]); webhook routing ([[Stripe Payments and Connect]]).

## Code

| Concern | Where |
| --- | --- |
| Status rules | `lib/payments/dispute-outcome.ts`: `outcomeOf`, `worstOutcome`, `isInquiry`, `caseTypeOf` |
| Recording, shared by both kinds of order | `lib/payments/purchase-disputes.ts`: `recordDispute`, `lostAmountOf`, `cancelQueuedReversals`, `alertDisputeReview`, `alertDisputeUnmatched` |
| Ticket orders | `reconcileDisputeEvent`, `restoreDisputedTickets`, `markExternalRefundReviewed` (same file) |
| Commerce orders | `lib/commerce/payment-recovery.ts`: `reconcileCommerceDisputeEvent` |
| Tests | `tests/integration/purchase-disputes.test.ts` ("dispute transitions"), `tests/integration/commerce-payment-recovery.test.ts` ("commerce dispute transitions") |

## Recording

`PurchaseDispute`, one per Stripe dispute, on a ticket order or a commerce order (never both). Every `charge.dispute.*` event, including `funds_reinstated` and `funds_withdrawn`, is verified, journalled once, then projected from the dispute as re-read from Stripe:

- **Verification:** the dispute's PaymentIntent resolves to the order ([[Payment Lifecycle Refunds and Disputes]]), and the dispute is on that payment's charge, in its currency. Its amount isn't checked: a currency conversion can make a real dispute larger than its order (PAY-078). Otherwise nothing changes; log `stripe.dispute.unmatched` and alert `purchase_dispute_unmatched` with `reason` `no_order`, `other_charge` or `currency`.
- **Order of reads (PAY-076):** `providerReadAt` is when the dispute was read, taken before asking Stripe. A delivery whose read is older than the stored one changes nothing, so a slow, stale read can't overwrite a newer state.
- **Status:** `lost` → `lost`; `won` and `warning_closed` → `won`; `prevented` → `won` only with `caseType` `block`. A `resolution` (the cardholder was refunded) or no case type stays `open` and alerts until a person checks it in Stripe (PAY-075). Anything else, appeals included, is `open`: an appeal neither assumes a loss nor undoes one (PAY-068).
- **Lost before:** a dispute was lost if its last status was `lost` or it has a reversal (only a loss queues one), so an appeal between a loss and a win still counts as a win after a loss (PAY-081).
- **Inquiries** (`warning_*`, a bank's question before any chargeback) set no `disputeStatus`, put no ticket under review and block no refund; payouts hold the sale while one is open (PAY-037).
- **Worst of:** the order's `disputeStatus` is the worst chargeback: `lost`, then `open`, then `won` (SEC-024).
- **Lost amount:** the sum of lost chargebacks. With refunds made here and in Stripe, it decides whether the loss covers the whole payment.

## Transitions

| Move | Ticket order | Commerce order |
| --- | --- | --- |
| Opens, or a won or restored dispute reopens | `active` tickets → `refund_review` (`disputed`); `dispute_opened` once; alert `purchase_dispute_opened` | `dispute_opened` once; alert `purchase_dispute_opened` |
| While `open` | Refunds, resends, the manual mark and compensation refunds are refused | Refunds and pickup hand-over are refused |
| Lost, whole payment | Every ticket still standing `void` (`dispute_lost`, places back on sale); reversal queued; the buyer reads "Refunded by your bank" | Memberships end; reversal queued |
| Lost, part of it (PAY-074) | Tickets back to `active`; staff pick the ones it covered (`mark_reviewed`, voided as `dispute_lost`), at most the share of the order's tickets the money returned pays for, to the nearest ticket (PAY-082: 409 past that); alert `lost_for_part`; payouts hold the rest | Nothing ends; alert `lost_for_part` |
| Won | Tickets stay under review until staff restore them; refundable meanwhile; a cancelled event refunds it (PAY-036). A held compensation refund resumes | `disputeStatus` clears; a held compensation refund opens |
| Won after a loss (PAY-072, PAY-073, PAY-080, PAY-081) | A reversal never sent is `cancelled`; one claimed or `uncertain` is left to the worker, which finds a reversal Stripe made or re-reads the dispute. With every ticket voided by the loss and none checked in, the buyer is refunded (places may be resold, so never restored); with some voided, alert `won_after_loss`. With none voided (a part loss), alert `won_after_loss` only if a reversal is claimed, `uncertain` or `succeeded`: the society's share went although the buyer paid again | Reversal `cancelled`; alert `won_after_loss` (a membership may be ended or merchandise collected) |
| Lost after staff restored | The dispute is live again (`resolvedAt` cleared); the tickets are voided; alert `lost_after_restore` | n/a |

A reversal already sent stays: after a late win the buyer's refund doesn't reverse the transfer again (`reversesTransfer`), so Thunderstrux pays it from what the reversal returned.

**Restore** (`restore_tickets`, reason 8 to 500): only when `disputeStatus = won` and every unresolved chargeback is won, and never after a loss voided tickets (409: the buyer is refunded instead). It resolves the chargebacks and closed inquiries, leaves an open inquiry live so its escalation still counts (PAY-077), puts `disputed` tickets back to `active`, clears `disputeStatus` and appends `dispute_resolved`. A resolved dispute that Stripe later moves is live again (PAY-076). A dispute is not a refund.

**Who answers.** On destination charges the dispute is on the platform's account, and societies can't see it in Express, so the platform operator answers it in Stripe's Dashboard ([[Production Operations]]). An unanswered dispute is lost.
- **Draft answer** (`stageDisputeEvidence`): once a newly opened dispute is recorded, the facts Thunderstrux holds are staged with `disputes.update(..., { submit: false })`, only while Stripe still takes an answer and nothing is on it yet. Tickets: buyer, what was bought, the event date, door scans, today's refund policy, and every refund already made. Commerce: buyer, lines, refund policy, a collected pickup, refunds. A failure alerts `dispute_evidence_not_staged`; it never fails the webhook.
- **Reminder:** the monitor alerts `purchase_dispute_evidence_due` for a dispute still answerable whose `evidenceDueBy` is within 72 hours, every 6 hours, until its status moves.

## Runbook for review alerts

`purchase_dispute_needs_review` is deduplicated per dispute, status and reason. Open the dispute in Stripe from the order page.
- **`lost_for_part`:** pick the tickets the returned amount covered on the order page (memberships and merchandise: decide in Stripe). The rest stays valid and held.
- **`won_after_loss`:** the bank re-billed the buyer after a loss. Refund them by hand, or record why not; for tickets this fires only when one was used or some still stand. If every ticket stands (a part loss), the buyer is owed nothing: the reversal took the society's share, so once Stripe shows it `succeeded`, return that amount to the society's account with a transfer in Stripe and note it on the order.
- **`lost_after_restore`:** the tickets were voided again; tell the buyer if they were relying on them.
- **`prevented_unconfirmed`:** read the dispute's case type and balance transactions in Stripe. If Stripe refunded the cardholder, the money is gone: treat it as lost.

## Related

[[Payment Lifecycle Refunds and Disputes]] · [[Payment Lifecycle]] · [[Stripe Payments and Connect Payouts]] · [[Production Operations Alerts]]
