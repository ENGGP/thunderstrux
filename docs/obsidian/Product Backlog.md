---
status: living
last-reviewed: 2026-11-07
owner: product
related: ["[[Project Handover]]", "[[Issue and Defect Register]]", "[[Pre-hosting Candidate]]", "[[THUNDERSTRUX_PRD]]"]
sources: [docs/THUNDERSTRUX_PRD.md, prisma/schema.prisma, lib/payments/checkout-reconciliation.ts, lib/payments/compensation-refunds.ts]
---

# Product Backlog

**Owns:** the ranked list of work not yet started (product, engineering and docs), with how comparable ticketing platforms handle each item and the smallest version worth building.

**Read when:** choosing the next piece of work, or before planning a product change, to see whether it is already ranked and how small it should be.

**Not here:**
- open defects and accepted risks ([[Issue and Defect Register]]; backlog items cite their IDs);
- the go-live steps ([[Pre-hosting Candidate#Go-live checklist for thunderstrux.com]]);
- product intent ([[THUNDERSTRUX_PRD|Product Requirements]]).

## Rules

- **Grounded in competitors, critically.** Each product item names how Humanitix, Eventbrite, Luma or TryBooking handle it. A competitor having a feature isn't a reason to build it: it has to be something a student society running O-Week, a ball, a pub crawl or a weekly meetup would miss.
- **Smallest complete version.** Each item states the smallest version that does the job. Anything bigger needs its own case in the PR that builds it.
- **Priorities:**
  - P0 blocks real users or real money.
  - P1 is what the first pilot society would feel.
  - P2 is worth doing soon, is cheap, or makes the next change safer.
  - P3 waits for the signal it names.
- **Sizes:** S is under a day, M is a few days, L is a week or more.
- **Keeping it current:**
  - When an item ships, delete its row in the same PR; the PR and [[Project Handover]] record it.
  - An item that turns out to be a defect moves to the register.
  - IDs (`BL-nn`) are never reused.

## P0: before real users

Most of this is owner work; no code blocker is known.

| ID | Item | Why | Size | Owner | Where |
| --- | --- | --- | --- | --- | --- |
| BL-01 | Redeploy the preview with every merged migration. First set the rate-limit settings `ops:deploy` requires: `RATE_LIMIT_ENABLED`, `RATE_LIMIT_TRUSTED_PROXY_HEADER=cf-connecting-ip` and the Redis URL. | The preview predates the run-2 to run-4 audit fixes, so the bank-change wait and the owner-pointer migration are unproven on a real database. | S | Owner approves; engineering runs it | [[Project Handover#Current state]], [[Production Operations]] |
| BL-02 | Merge the two compensation engines (DEBT-003). Fold the dispute, outside-refund and payment-check copies into the same PR, keeping ticket orders' manual-review mode. There are three payment checks: `verifiedOrderPayment`, `verifiedCommercePayment` and `verifiedPayment`. | The register wants it before PAY-002's campaign, so the campaign tests the engine that stays. Until then every money fix is made twice. | L | Engineering | `lib/payments/compensation-refunds.ts`, `lib/payments/order-refunds.ts`, `lib/payments/purchase-disputes.ts`, `lib/commerce/payment-recovery.ts` |
| BL-03 | Run PAY-002's campaign on hosted endpoints after BL-02: manual compensation confirm, a held refund released by a win, and a review closed by a loss. | Refunds are automatic by default, so this proof comes before any real sale. | M | Payments and operations | [[E2E and Staging Payments]] |
| BL-04 | Decide PAY-054: alert when an outside refund that quietly closed a queued one later fails. | Today the buyer gets nothing and nobody is told. Smallest version: on `charge.refund.updated` with a failed status, alert if the app closed a request because of that refund. | S | Engineering | [[Payment Lifecycle Refunds and Disputes]] |
| BL-05 | Get the independent review of authentication, tenancy and money changes, including every audit PR since the last list in [[Project Handover#Next safe actions]] (#291 to #304). | It's a release gate, and `/code-review` doesn't count. | M | Founder finds a reviewer | [[Pre-hosting Candidate#Gates before real users and real money]] |
| BL-06 | Hosting and its gates: H01 to H05, OPS-001 to OPS-005, SEC-001, SEC-002, SEC-019, the database pool, the notification key, and the Stripe Express questions. | These are the real launch blockers. | L | Owner | [[Pre-hosting Candidate#Go-live checklist for thunderstrux.com]] |
| BL-07 | Terms of Service and a reviewed privacy policy (LEGAL-001). | Needed before the first sale. Humanitix and TryBooking publish organiser and buyer terms. | M | Founder and a lawyer | [[Issue and Defect Register]] |
| BL-08 | Choose the platform support address and who owns it (`PLATFORM_SUPPORT_EMAIL`). | Buyers and societies need somewhere to write. | S | Founder | [[Pre-hosting Candidate#Support and response]] |
| BL-09 | Owner housekeeping: re-password or disable the seeded dev accounts, check that `ops-preview-admin` stops and is removed on Ctrl-C (ADMIN-001), and add an `ASSET_STORAGE_*` bucket to the preview. | Small, overdue and cheap. | S | Owner | [[Project Handover#Next safe actions]] |

## P1: the first pilot society will feel these

The PRD's "What comes next" order, after three quick wins. None of these exist today.

| ID | Item | How others do it, and the smallest version | Size | Where |
| --- | --- | --- | --- | --- |
| BL-10 | Copy an event | **Others:** Eventbrite's "Copy event", Luma's "Duplicate". Recurring series are a much bigger feature. **Smallest:** one Duplicate action that copies the event, ticket types, codes and settings into a draft with the dates cleared. That covers weekly meetups without a recurrence engine. | S | `lib/events/event-lifecycle.ts` |
| BL-11 | A description and a sales window for each ticket type | **Others:** every competitor; "early bird ends Friday" is how balls sell. **Smallest:** `description`, `salesStartAt` and `salesEndAt` on `TicketType`, checked at checkout under the existing event lock. | M | `prisma/schema.prisma`, `lib/payments/checkout-creation.ts` |
| BL-12 | Add to calendar from the ticket | **Others:** Luma and Eventbrite attach an `.ics` file; today there is only a Google link on the event page, and most students use iPhones. **Smallest:** one `.ics` route per event, linked from the ticket email and the ticket page. | S | `components/events/public-event-view.tsx`, `lib/email/ticket-delivery.ts` |
| BL-13 | No email step before a guest checks out (PRD item 1) | **Others:** Humanitix and Eventbrite take the email at payment. Stripe already collects it, so send the tickets and a signed order link there. The email check stays for finding and claiming a purchase. | M | `components/events/public-ticket-purchase.tsx`, `app/api/payments/checkout/event/route.ts` |
| BL-14 | Buyer pays the fee, as an option (PRD item 2) | **Others:** Humanitix and TryBooking "pass on fees"; Eventbrite "pass fees to buyer". **Smallest:** one society-level switch, not per event. Show the all-in price from the first view, because Australian rules ban drip pricing. Refunds return the fee as today (PAY-008). | M | `lib/stripe/fees.ts`, `components/settings/stripe-connect-settings.tsx` |
| BL-15 | Several ticket types in one order (PRD item 3) | **Others:** every competitor. Today a member and a friend need two checkouts. **Smallest:** order lines shaped like `CommerceOrderLine`. This rewrites `reconcileCompletedCheckoutSession`, so split that function as part of this work, not separately. Land BL-02 first: both touch reconciliation. | L | `prisma/schema.prisma`, `lib/payments/checkout-reconciliation.ts` |
| BL-16 | Attendee names, checkout questions, student number (PRD item 4) | **Others:** Humanitix has questions per ticket. Balls need dietary needs and a plus-one's name; clubs report student IDs to the student union. **Smallest:** a name on each `Ticket`, plus up to about five questions per event (short text, one choice, yes/no) shown in the roster and CSV. No form builder. The CSV repeats the buyer's name today. | M–L | `prisma/schema.prisma`, `lib/export/order-exports.ts` |
| BL-17 | O-Week: guest membership and a member card (PRD item 5) | **Others:** none do society memberships well, and that's Thunderstrux's edge. **Smallest:** a guest buys a membership through BL-13's flow and claims it later. The card is one page under My tickets: name, society, expiry and a QR the door console reads. No wallet pass. | M | `app/(public)/societies/[orgSlug]/memberships/[planId]/checkout/page.tsx`, `lib/memberships/` |

**Order:** BL-10 to BL-12 first. Then BL-13 to BL-17 in order, because each leans on the one before: the guest flow before the guest membership, and multi-type orders before attendee names.

## P2: worth doing soon

### Product

| ID | Item | Why, and the smallest version | Size | Where |
| --- | --- | --- | --- | --- |
| BL-18 | Reminder email the day before | **Why:** Luma and Eventbrite send one by default. It cuts no-shows on free RSVPs. **Smallest:** one outbox job per event about 24 hours out, with no settings. | S–M | `lib/email/` |
| BL-19 | Message attendees | **Why:** Luma has "Blast", Eventbrite "Email attendees". Today only change and cancellation emails go out. **Smallest:** plain text to the event's ticket holders, sent by owners and admins only, a few a day per event, through the outbox, recorded in History. | M | `lib/events/event-changes.ts` |
| BL-20 | Buyer refund request | **Why:** Humanitix and Eventbrite tie a buyer's "request refund" to the policy. `RefundRequest` already has `buyerMessage`; only the buyer path is missing. **Smallest:** the buyer asks, and staff approve or decline through the existing refund flow. Never automatic. | M | `lib/payments/order-refunds.ts` |
| BL-21 | Treasurer exports | **Why:** Eventbrite and Humanitix give payout reports, and a treasurer reconciles the bank at handover. **Smallest:** fee, net and payout columns in the orders CSV, plus a payouts CSV. | S–M | `lib/export/order-exports.ts`, `components/settings/payouts-card.tsx` |
| BL-22 | Tax receipt with an optional ABN | **Why:** Humanitix and TryBooking issue tax invoices, which sponsors and universities ask for. Many societies aren't registered for GST, so the ABN is optional and GST shows only if registered. **Smallest:** an optional ABN on `Organisation` and a receipt block in the order email. | M | `prisma/schema.prisma` |
| BL-23 | 18+ and accessibility notes on events | **Why:** Humanitix has both; a pub crawl needs "18+, bring ID". **Smallest:** an 18+ flag shown on the event and ticket, plus one free-text accessibility field. Nothing enforced. | S | `lib/validators/events.ts` |
| BL-24 | A per-buyer limit the organiser sets | **Why:** every competitor allows it; the limit is fixed today. **Smallest:** an optional maximum per order on each ticket type. | S | `lib/validators/payments.ts` |
| BL-25 | Sitemap, robots and Event structured data | **Why:** public events can then appear in Google's event results, as Eventbrite's do. **Smallest:** Next's sitemap and robots files in `app/`, plus JSON-LD on the event page. | S | `app/(public)/events/[eventId]/page.tsx` |
| BL-26 | Cut what's over-built (the PRD's "Later") | **Why:** no competitor asks an organiser to pick a compensation mode or hold length per event. **Smallest:** remove both from the event form and keep the defaults (`automatic_full`, 20 minutes). The columns stay. | S–M | `lib/validators/events.ts` |

### Engineering

| ID | Item | Why | Size | Where |
| --- | --- | --- | --- | --- |
| BL-27 | Make `destination` required in `reconcileCompletedCheckoutSession` | An exported money function skips the connected-account check when the argument is left out; only tests do that. Make the tests pass it. | S | `lib/payments/checkout-reconciliation.ts` |
| BL-28 | Move the last bare `console.*` calls to the structured logger (LOG-001) | So they're redacted like the rest, and the register row can close. | S | `lib/payments/checkout-reconciliation.ts`, `lib/stripe/connect.ts`, `lib/tickets/reservations.ts`, `lib/ops/logger.ts` |
| BL-29 | Delete the legacy access "allow" branch | Hosted config forces `deny`, and every new society gets a staff row. First confirm with a query that no society depends on `accountUserId` alone. The column itself stays for now. | M | `lib/staff/live-authority.ts`, `lib/auth/access.ts` |
| BL-30 | One Stripe review notice | The order page carries its own copy of the shared notice. Do it with BL-02, which changes that wording anyway. | S | `components/commerce/stripe-review-notice.tsx` |

### Docs

| ID | Item | Size |
| --- | --- | --- |
| BL-31 | [[Project Handover]]: refresh the snapshot from `prisma/migrations/`; say the preview is behind main; put the dated entries in order and re-attach audit-4 PR 1's bullets to their entry; mark the per-action code text superseded by SEC-076; rewrite Next safe actions items 1 and 7; and settle which migrations the dev database has. | S |
| BL-32 | [[THUNDERSTRUX_PRD\|Product Requirements]] "What comes next": drop "MFA on every staff page", which SEC-076 did, and update the "after the 2026-10-30 audit" framing. | S |
| BL-33 | [[Issue and Defect Register]]: DEBT-003 names the third payment check; DEBT-004 drops the Stripe-settings part, which is already one fetch. | S |
| BL-34 | [[Accessibility Review]]: "Open for the pilot (T44)" becomes H06. The delivery plan stops calling T43b, T43c and T45 open. | S |
| BL-35 | Split Payment Lifecycle, Database and Multi Tenancy, and UI Architecture Rules before the next feature edits them: each is within a few dozen bytes of the size limit, and BL-11, BL-15 and BL-16 all touch them. | S–M |

## P3: later, on a real signal

| ID | Item | Signal |
| --- | --- | --- |
| BL-36 | Waitlist that offers freed spots (Luma, Eventbrite) | A capped free event sells out and BL-18 hasn't freed enough spots. |
| BL-37 | Change the attendee name on a ticket (Humanitix). Not full transfer, which invites scalping. | After BL-16, when a society asks. |
| BL-38 | Apple and Google Wallet passes (Humanitix, Eventbrite, Luma). They need an Apple developer certificate and signing; the QR ticket page already works. | Door staff report slow phones. |
| BL-39 | Discovery filters: category, free, campus | Enough societies that `/events` is hard to browse. |
| BL-40 | Sales sources: referrer and UTM (Eventbrite) | A society asks which channel sold its tickets. |
| BL-41 | Stored image sizes (PERF-004) | The first real photos are slow on a phone. |
| BL-42 | Early payout release | A society can't pay a venue deposit; weigh it against PAY-022 first. |
| BL-43 | Paging on My tickets and membership offers | Someone reaches the row cap. |
| BL-44 | Leave the next-auth beta; move to Prisma 7 | A security advisory, or a feature the current version blocks ([[Dependency Automation]]). |
| BL-45 | Passkeys for operators, and a second admin's approval (SEC-045, ADMIN-001) | Hosting is chosen and there are two admins. |
| BL-46 | Decide which of the integrity audit's audit-only checks should repair | Drift shows up in real data. |

## Not doing

- **Reserved seating, offline check-in, a recurring-event engine, a form builder.** These are enterprise features. A society's door has Wi-Fi or a hotspot, and BL-10 and BL-16 cover the real needs.
- **The assistant (T35 to T37).** The founder deferred it.
- **Clean-up for its own sake:** tests that need no database, moving test hooks out of production modules, trimming exports used only in their own file, splitting large files. Do these only inside a change that already touches that code. BL-15 splits the reconciliation function.

## Related

[[Project Handover]] · [[Issue and Defect Register]] · [[Pre-hosting Candidate]] · [[THUNDERSTRUX_PRD|Product Requirements]]
