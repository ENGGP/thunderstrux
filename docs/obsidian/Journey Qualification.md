---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[E2E and Staging Payments]]", "[[Engineering Delivery Workflow]]", "[[Production Operations]]", "[[Accessibility Review]]", "[[Pre-hosting Candidate]]"]
sources: [docs/MVP_READINESS_PLAN.md, docs/THUNDERSTRUX_PRD.md, tests/e2e/journeys.spec.ts, tests/e2e/permission-matrix.spec.ts, scripts/run-e2e.mjs, scripts/run-operations-tests.mjs]
---

# Journey Qualification

**Owns:** the map from each product journey (section 7 of `docs/MVP_READINESS_PLAN.md`, from the PRD) to the tests that prove it, and what local qualification can and can't reach.
**Read when:** changing a user journey, deleting or renaming a test that appears below, or deciding which campaign re-qualifies a change.
**Not here:** how the campaigns run ([[E2E and Staging Payments]]); the operations rehearsal ([[Production Operations Hosting]]); which validation a change needs ([[Engineering Delivery Workflow]]); release gates ([[Pre-hosting Candidate]]). Dated qualification runs: [[Evidence Ledger]].

## Rules

- A requirement counts as covered only when a test shows both its happy path and its denial.
- Qualification runs against the release images with production settings: the `web` image serves the app, the `ops` image migrates and runs workers, staff MFA is enforced in its own step, legacy organisation access is denied.
- Names below are test files: e2e `<name>` is `tests/e2e/<name>.spec.ts`, integration `<name>` is `tests/integration/<name>.test.ts`. **Bold** marks the connected journeys in `tests/e2e/journeys.spec.ts` and the role matrix in `tests/e2e/permission-matrix.spec.ts`. "Operations rehearsal" is `pnpm ops:test` (`scripts/run-operations-tests.mjs`).
- Renaming or deleting a listed test, or changing what it asserts, means updating its row in the same PR.

## How the evidence is produced

- **Browser campaign** (`pnpm test:e2e`): builds the release pair, migrates from the ops image and runs Playwright against the web image with synthetic accounts, signed Stripe webhooks, captured email and a local object store. `journeys.spec.ts` runs in the webhook step, which has a synthetic Stripe test key.
- **Baseline** (`node scripts/run-e2e.mjs baseline`): the integration suite.
- **Operations rehearsal:** deploy, workers, backup, fenced restore, rollback.
- **Real providers:** Stripe test mode and Resend acceptance in [[E2E and Staging Payments]]; Spaces is blocked until its values are set (OPS-005).

**What the browser campaign can't reach.** It has no Stripe account: a paid checkout's Session is seeded as the app would create it, and Stripe's answers arrive as signed webhooks (`checkout.session.completed`, `refund.updated`). Ticket emails go straight to the provider, so they are checked as queued jobs. Links a guest opens come from captured notification emails (email confirmation, Find your purchase).

## Attendees and members

| Journey | Requirement | Covered by |
| --- | --- | --- |
| Anonymous visitor | Society and event search | e2e `society-discovery` (anonymous discovery), `explore-events` (title, society, dates; desktop and phone) |
| | Branded profile | e2e `society-profiles` (branding, public on mobile) |
| | Date, location, price, organiser | e2e `public-event-pages` (visitor reads an event, then signs in to checkout) |
| | Merchandise | e2e `merchandise` (a guest checks out free merchandise) |
| | Drafts and member-only events concealed | e2e `browser` (draft isolation), `memberships` (members-only gate shows nothing about the event); integration `event-policy` |
| | Unlisted absent from lists | integration `explore-events`, `event-policy`; e2e `event-builder` |
| Guest attendee | Email verification | e2e `guest-access` (the link works once), `journeys` (guest pays) |
| | Free public ticket | e2e `guest-checkout` |
| | Paid public ticket | **e2e `journeys`**: guest verifies, Stripe's signed webhook fulfils two tickets and queues the ticket email; integration `guest-checkout` (paid hold returns to the guest page) |
| | Private receipt and recovery | e2e `guest-checkout` and **`journeys`**: from another browser the order address shows nothing, and Find your purchase opens it |
| | Check-in | **e2e `journeys`**: admitted once, recorded once |
| | Refund support | **e2e `journeys`**: Stripe's signed `refund.updated` (sent twice) voids both tickets once; the guest page says refunded with no door tickets; the door turns the second ticket away. Integration `guest-checkout` covers refunded and disputed guest pages |
| | Guessed purchase or foreign token denied | integration `guest-checkout` (another session, another guest, no session), `ticket-purchases`; e2e `journeys` (a stranger's browser) |
| Member onboarding and security | Signup, verify, login | e2e `browser` (signup, duplicate email, wrong password, logout) |
| | Profile and settings | e2e `account-lifecycle` (settings changes sign out other browsers); integration `account-settings-page` |
| | Join and leave | e2e `society-discovery` (verified join and leave show fresh state), **`journeys`** |
| | Password reset | e2e `account-lifecycle` (recovery revokes existing browsers); integration `password-recovery` |
| | Stale JWT denied | e2e `account-lifecycle`, `mfa-enforced` (a new password-only session denied); integration `auth-access`, `live-staff-authority` |
| | Safe callbacks | e2e `browser` (external callback stays on the app origin) |
| Member attendance | Free tickets | e2e `free-tickets` |
| | Paid tickets | e2e `webhooks` (signed fulfilment exactly once under concurrent replay), `purchases` (success page confirms until the webhook lands) |
| | Member price | **e2e `journeys`**: standard price until a paid membership, member price after; integration `member-prices` |
| | Stock and quote races | e2e `checkout-states` (price changed, sold out, fewer left, sales closed); integration `inventory-locks` (buyers racing for the last seat, a price changed before any hold, sales closing mid-checkout, a 30-buyer rush), `checkout-reservations` (live holds reduce availability) |
| | Decline, cancel, expiry | Card payments are declined inside Stripe's page; the buyer retries or leaves. e2e `webhooks` (expiry releases the hold), integration `ticket-purchases` (the cancel page names the order only to its buyer) |
| | Wallet, email, replay | e2e `purchases` (wallet of ticket faces), `webhooks` (replay fulfils once, one email job); integration `email-outbox` |
| | Void ticket denied at check-in | e2e `check-in` (refunded ticket shows Don't admit), **`journeys`** |
| Membership relationship | Free join distinct from term purchase | e2e `memberships` (a join alone is not a membership), **`journeys`** (a join gives no member price) |
| | Future, current, renew, expiry | integration `membership-offers`, `membership-grants` |
| | Member-only | e2e `memberships` (members-only gate) |
| | Leave keeps a paid grant | **e2e `journeys`** (leaving keeps the membership and the member price); integration `membership-revocation` |
| | Refund revokes | **e2e `journeys`** (Stripe's signed refund revokes it; My memberships shows it under Revoked; the standard price returns); integration `membership-refunds` |
| Buyer purchase history | Tickets, memberships and merchandise in one list | e2e `purchases`; integration `ticket-purchases` (Purchases lists every order in the buyer's words) |
| | Pending, failed, refunded, compensation | integration `ticket-purchases`, `compensation-refunds`; e2e `purchases`, `order-refunds` |
| | No other user's record | integration `ticket-purchases` (another member's order is the same 404) |

## Societies and staff

| Journey | Requirement | Covered by |
| --- | --- | --- |
| Guest merchandise | Verified basket, checkout, receipt | e2e `merchandise` (a guest checks out free merchandise; the order page shows each state); integration `merchandise-sale` (free basket for a verified guest, receipt naming the pickup) |
| | Stripe | integration `commerce-checkout` (one Session per order and key; the signed webhook fulfils once) |
| | Ready and collection | e2e `merchandise` (marked ready and collected on Pickups; the buyer sees each step) |
| | Refund | integration `merchandise-after-sale` (a refund cancels an uncollected pickup and never restocks) |
| | Cross-society or membership purchase denied | integration `merchandise-sale` (other societies' options refused), `commerce-orders` (a membership is never a guest's), `commerce-checkout` (only members may buy) |
| Society bootstrap | Verified organisation creates one tenant | e2e `society-profiles` (new organisation bootstrap); integration `society-profiles` (bootstrap is atomic and handles slug races) |
| | Profile, branding, contact | e2e `society-profiles` (branding saves; conflicting edits kept); integration `society-profiles` |
| | Named owner and MFA | e2e `mfa-enforced`, **`permission-matrix`** (every role sets up MFA before any page) |
| | Connect | e2e `payments-page`; integration `connect-safety` |
| | Second tenant denied | **e2e `permission-matrix`** (another society's owner gets 404 for every record and can't take the context); integration `organisation-tenancy` |
| Committee handover | Verified invite, accept, roles | e2e `browser` (private invitation: acceptance, resend, revocation) |
| | Transfer, revoke, live session | e2e `mfa-enforced` (handover with enforced MFA removes the outgoing live session), `browser` (live-session revocation) |
| | Final owner kept under concurrent changes | integration `staff-handover` (parallel handover commits once; racing closure never strands owners), `account-closure` (concurrent owner demotions keep one active owner) |
| | Joining gives no management | e2e `browser` (joined members, even with staff-looking roles, can't manage) |
| Event operator | Draft, details, types, visibility, capacity | e2e `event-builder`; integration `event-policy` |
| | Publish blockers | integration `event-policy` (paid-only events without payments; future sales window), `event-lifecycle` |
| | Close, edit, calendar | e2e `event-builder` (moving an event emails holders), `calendar` (month, week, agenda); integration `event-policy` (closing sales) |
| | Public preview | e2e `public-event-pages` (draft preview exactly as buyers see it, buying off) |
| | Attendance and history | e2e `check-in`, `history` |
| | Sold deletion and unpublish denied | integration `event-lifecycle` (unpublish blocked after orders; sold ticket types not deleted); e2e `browser` (confirm before unpublishing) |
| Membership operator | Products, terms, roster | e2e `memberships` (draft, publish check, publish, archive; Members tab); integration `membership-grants` (roster states) |
| | Current and next terms, renew | integration `membership-grants` (the next term follows, never overlaps), `membership-offers` |
| | Revoke and refund, history | e2e `memberships` (refund names the amount); integration `membership-revocation`, `membership-refunds` |
| | Cannot invent paid status | integration `membership-grants` (a paid plan grants only from the verified webhook) |
| Merchandise operator | Images, options, stock, publish | e2e `merchandise` (photo and options, publish, archive) |
| | Holds and orders | integration `merchandise-sale` (stock edits can't go below holds) |
| | Ready, collect, return, refund | e2e `merchandise` (Pickups; return and cancellation); integration `merchandise-after-sale` |
| | Exactly-once stock effects | integration `merchandise-sale` (two buyers race for the last unit; the webhook takes stock once), `merchandise-after-sale` (a return restocks once) |
| Calendar | Owner reads by month, week, agenda | e2e `calendar`; integration `calendar` (never another society's) |
| Permission matrix | Every staff role against every dashboard page, two societies, enforced MFA | **e2e `permission-matrix`**: owner, admin, event manager, finance manager and check-in staff each set up MFA. Each then opens every dashboard page: 200 exactly when the role holds the page's permission, a concealed 404 otherwise. Another society's owner gets 404 for every record page and is refused the context and its API reads. The role map is `lib/permissions`. |

## Finance and operations

| Journey | Requirement | Covered by |
| --- | --- | --- |
| Finance operator | Connect | e2e `payments-page` (connecting, fees, what free tickets need); integration `stripe-connect-service` (readiness without Stripe I/O; account creation audited), `connect-safety` |
| | Charge and payout distinction, fees, net | e2e `payments-page`, `analytics` (sales on Analytics); integration `analytics-metrics` (money left out without finance access), `purchase-snapshots` (fee recorded at purchase) |
| | Refunds | e2e `order-refunds` (confirmation, wrong reference refunds nothing, refunded order says so), `journeys` (signed refund voids once); integration `order-refunds`, `purchase-disputes` (partial refunds flagged; disputes pause refunds) |
| | Compensation | integration `compensation-refunds` (one automatic refund per fenced job; polls a pending one after a missed webhook without creating another) |
| | Email requeue | integration `email-outbox`, `notification-outbox` (bounded, fenced requeue), `organiser-orders` (failed-notifications list) |
| | Reconcile | integration `webhook-reconciliation` (idempotent fulfilment; mismatches go to compensation), `checkout-attempt-recovery` (the same Stripe key replayed), `purchase-disputes` |
| | Non-finance staff see no money | **e2e `permission-matrix`** (orders, notifications and member records 404 for event managers and check-in staff); integration `analytics-metrics`, `orders-api` (member denial; another society's order 404), `organiser-orders` (a finance manager opens a merchandise order but can't hand it over) |
| Operations recovery | Stop jobs and writers | integration `worker-contract` (pause all or one); operations rehearsal (pause, overlap, reclaimed lease) |
| | Separate restore | operations rehearsal (backup, a corrupt archive quarantined, restore into a new `_restore_test` database) |
| | Schema, inventory, grants and history audit | operations rehearsal (`verify-restored-database`: migration history, domain records, invitation decryption, ownership continuity and the integrity audit with no unexplained violations) |
| | Provider reconciliation, then a fenced restart | **`ops:restore` pauses every worker in the restored copy**, and the operations rehearsal checks it. **Integration `recovery-fencing`**: a restored refund stays still while fenced; after resuming it settles from Stripe's own refund, with no second refund, one buyer notice and one history entry. A refund Stripe never received is sent once under its fixed idempotency key |
| | No duplicate external effects | integration `recovery-fencing`, `compensation-refunds` (polls after a missed webhook without another refund), `checkout-attempt-recovery` (same key, never a second Session), `email-outbox` and `notification-outbox` (provider keys); e2e `webhooks` (concurrent replay fulfils once), `journeys` (a refund event sent twice voids once) |

## Not covered here

- Real providers beyond Stripe test mode and Resend acceptance: inbox delivery, Spaces (OPS-005), hosted webhooks.
- Real users (H06) and certified accessibility ([[Accessibility Review]]).
- The assistant (OpenClaw) is deferred.

## Related

[[E2E and Staging Payments]] · [[Production Operations]] · [[Engineering Delivery Workflow]] · [[Pre-hosting Candidate]] · [[Accessibility Review]]
