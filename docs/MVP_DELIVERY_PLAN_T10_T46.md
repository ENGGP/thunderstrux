# Thunderstrux T10–T46 Delivery Plan

**Status:** execution plan, drafted 15 October 2026 against main `33e84ce`; revised 16 October 2026 against main `e60809e` (36 migrations, 22 models, 398 integration tests and 34 browser checks) after a code check of the plan's claims. T10 (#68) and T11a (#70) have merged.

**Authority:** the [Readiness Plan](MVP_READINESS_PLAN.md) owns scope, invariants, the work packages and the definition of done for every T task, and since 16 October 2026 lists every split below as ordered substeps (T11a/b, T14a/b, T15a/b, T16a–c, F1 and T18a–c, T19a/b, T24a/b, T37a/b). This plan only decides the order, the PR boundaries, the shared building blocks and the design system for the new screens. Where the two disagree, the readiness plan wins and this file is corrected. Delivery follows the [Engineering Delivery Workflow](obsidian/Engineering%20Delivery%20Workflow.md).

## 1. Summary

- The 37 tasks become 52 focused PRs in twelve waves of two to five PRs (section 5), plus small follow-ups such as the T11a free-ticket gate. Each PR starts from refreshed `origin/main` on a `codex/tNN-…` branch and closes one task or one ordered substep.
- **Build each shared mechanism once**, in the first task that needs it, and reuse it: inventory locks and sellable stock (T12), event readiness (T11), checkout attempts (T14), the purchase status projection (T10), the financial fence (T18) and free-purchase cancellation (T18). Section 3 lists them.
- **Each owning task writes its own audit rows, notification intents and central error mapping.** T30, T38 and T39 then close gaps and prove coverage instead of retrofitting 30 tasks of code.
- **The UI grows from one planned design system:** a fixed status vocabulary, a navigation end state, a short list of new primitives, and three design rounds on the existing canvas, each approved before that block's UI PRs (section 4). Backend PRs do not wait for design.
- Three order changes, all allowed by the dependency graph: **T14a before T13** (free checkout reuses the idempotency table instead of building a second one), **F1 (AUTHZ-001) before T18** (refund and commerce workers would otherwise add a seventh and eighth copy of the authority check), and **T17 before T15**.

## 2. Starting point

Facts from the code that shape the plan:

- **One ticket type per order.** `Order` has `ticketTypeId`, `quantity`, `unitPrice` and `totalAmount`. Keep that (UX decision DEC-04); the buy box already offers one ticket choice.
- **Locks are inconsistent.** Checkout locks User then TicketType; the webhook locks TicketType then Order; nothing locks Event. `updateOrganisationEvent` edits price and quantity with no lock at all, so an edit can land between a quote and a hold. T12 fixes this with one helper.
- **Free tickets are impossible today.** Checkout rejects totals of 0 and `calculatePlatformFee` throws on 0. So every existing order is a Stripe order: that is a known fact T10 can backfill.
- **Buyer snapshots already exist.** T04c added `buyerEmailSnapshot` and friends, written only at account closure, with a CHECK that allows only provenance `current_account_at_capture` and a trigger that makes a capture immutable. T10 reuses these columns instead of adding new buyer fields.
- ~~Publishing is a replay-unsafe toggle, create accepts `status: "published"` (EVT-003), and publish checks only total quantity.~~ Resolved by T11a (#70).
- **Checkout reads before it locks.** Price, event status, sale state and close time are read before the TicketType lock and not rechecked under it; only quantity is (`checkout-creation.ts`). Holds compare `expiresAt` with application time, not database time (`reservations.ts`). The stale-order worker's SKIP LOCKED helpers are never used. All three belong to T12.
- **Readiness is only partly wired.** The publish API and dashboard use `eventReadiness`; checkout uses only `salesOpen` and repeats its own sold-out and Stripe checks; public reads do not use it. T12 finishes checkout, T15a the public page.
- **Free types were counted as buyable** by readiness while checkout rejects zero totals, so a free-only event could publish unbuyable. The T11a follow-up adds `FREE_TICKETS_ENABLED = false`; T13 turns it on.
- **`status = paid` reads that T13 must split by `paymentKind`:** `event-analytics.ts`, `event-lifecycle.ts` (orders count), `member-tickets.ts`, `organisations/overview.ts`, `grouped-orders.ts`, `order-detail.ts`, `ticket-delivery.ts`, `ticket-email-outbox.ts`, `account-closure.ts` and the dashboard orders page.
- **The Stripe Session has no idempotency key**, and a Stripe timeout marks the order failed and releases the hold; a later paid webhook then lands in compensation. T14a replaces this.
- **The event form** takes prices in cents (EVT-002) and parses times in server time (EVT-001). There is no timezone library and no chart library; revenue by day is CSS bars. Neither is needed: `Intl` and CSS/SVG cover T11, T22, T32 and T33.
- **`proxy.ts`** sends anonymous visitors on `/events/*` to login and organisation accounts to the dashboard (T15 removes both).
- **The webhook** handles `checkout.session.completed/expired` and `refund.*` only: no disputes, no purchase-family routing.
- **Paid checkout has no quantity cap** (`createEventCheckoutSchema` has only `min(1)`).
- **UI building blocks:** Button, TextInput/TextArea/Select, Card, Notice, StatusBadge (the one status mapping), Skeleton/ListSkeleton, ConfirmDialog, Icon (20 icons), PageHeader, EventWorkspaceHeader and its link tabs, DateRail, EventCard, SocietyCard; AuthShell, PersonalShell and DashboardShell. [UI Architecture Rules](obsidian/UI%20Architecture%20Rules.md) owns their contracts.
- **Register items this plan absorbs:** EVT-001/002 (T11b; EVT-003 resolved by T11a), PUB-001 (T15b), API-001 (T11a events done, T11b ticket types, T17 Connect, T18a orders, T19b tickets, T39 the remaining profile, asset, join, invite, account-email, auth-confirm and search routes), PAY-001 and TEST-001 (T18b), AUTHZ-001 (F1), PAG-001 (T19b, T29), PERF-002 (T31), PERF-001 local evidence (T31, T41), AUD-001 (T38).
- **Housekeeping (done):** the two design-sync commits left out of #67 landed in #69; the animate skill landed in #71. `.claude/` stays untracked.
- **Local development data:** the dev stack applies new migrations when it starts. Before restarting it on a branch with a new migration, take a dump as [Troubleshooting](obsidian/Troubleshooting.md) describes; never reset the dev volumes.
- **Hosted work is outside this plan:** H01 to H06 in the readiness plan need a deployed environment and follow T46.

## 3. Shared building blocks

| Building block | Module | Built in | Reused by | Rule |
| --- | --- | --- | --- | --- |
| Inventory locks and sellable stock | `lib/events/inventory.ts` | T12 | T13, T14, T16, T18, T24b, public reads, T31 | The only place that locks Event and TicketType rows or computes sellable (readiness plan §3.2). No raw `FOR UPDATE` on those tables elsewhere. |
| Event readiness | `lib/events/event-readiness.ts` | T11a | publish and sales routes and dashboard reads (T11a); checkout fully in T12; public pages in T15a; builder, T17, T34, T35 `explain_readiness` | One function returns publication blockers and per-type checkout eligibility; the UI never recomputes them. `FREE_TICKETS_ENABLED` (T13) and `MEMBERS_ONLY_EVENTS_ENABLED` (T24b) gate states checkout cannot serve yet. |
| Checkout attempts | `lib/payments/checkout-attempts.ts` | T14a | T13 free, T16 guest, T21 commerce | Same key and payload returns the same result; a different payload is a 409. |
| Purchase status projection | `lib/purchases/projection.ts` | T10 (tickets) | T13, T18, T19, T20, T29, emails, T31 | One precedence function (UX §9.6) per family returns a key from section 3.2; pages never read `status === "paid"` directly. |
| Financial fence and refunds | `lib/payments/purchase-refunds.ts` | T18a | T21 compensation, T23 revocation, T28 | At most one provider-changing operation per purchase; the fence also blocks late fulfilment. |
| Free-purchase cancellation | `lib/payments/free-cancellation.ts` | T18c (tickets) | T23 grants, T28 pickups | One service shape per readiness plan §3.3; never a refund row. |
| Money | `formatMoney`, `parseMoneyInput` (string to cents, no floats), fee helper with a zero branch | T11b, T13 | T17, T22, T24b, T25 | Integer AUD cents everywhere; "Free" for a zero price. |
| Society-zone time | `lib/time/zoned.ts` | T11b | T22, T33 | Local wall time plus IANA zone to UTC and back; ambiguous or missing DST times are a field error, never a silent shift. |
| Live staff authority | one database-only helper | F1 | all routes and workers | Replaces the six copies listed in AUTHZ-001. |
| Notifications | `enqueueNotification` / ticket outbox | each owning task | T30 | The task that creates the business fact inserts its intent in the same transaction. T30 adds change fanout, preferences, reminders and the matrix test. |
| Audit | `AuditLog` in the business transaction | each owning task | T38 | Safe actor, target, version, reason and before/after facts from day one. |
| API errors | `mapRouteError` | every new route | T39 | Every route since T39; `route-contract.test.ts` fails a route that skips it. |
| Pagination | `lib/pagination/cursor.ts` (exists; used by member tickets, public events and grouped orders) | every new list | T19b, T29 | The three older copies (check-in, order lifecycle history, notification outbox) are folded in when their list changes (PAG-001). |
| Test and recovery fixtures | `tests/helpers/test-data.ts`, `db-reset.ts`, schema contract, `prisma/seed.mjs`, `scripts/verify-restored-database.mjs`, `scripts/seed-operations-verification.mjs` | every schema PR | T41, T44 | A model is not done until reset, seed and restore verification know about it. |

### 3.1 One lock order

```text
User row (account fence; only on paths that lock the buyer, as checkout and closure already do)
  -> Event
  -> TicketType rows, ascending id
  -> Order and CheckoutAttempt
  -> TicketReservation, RefundRequest, CompensationRefundJob, EmailOutbox, OrderLifecycleEvent

Memberships:  User -> Organisation (member + society term fence) -> CommerceOrder -> lines, grant, outbox, lifecycle
Merchandise:  MerchandiseVariant rows, ascending id -> CommerceOrder -> lines, reservations, pickup, outbox, lifecycle
```

The readiness plan lists Event first. The User fence already precedes it in checkout and in T04c account closure and must stay first. No path may lock an Order and then an Event or TicketType; T12's review greps for it and its concurrency tests run edit, checkout and webhook in parallel.

### 3.2 One status vocabulary

Every badge goes through `components/ui/status-badge.tsx`; a key is added when its state first becomes reachable. The organiser and the buyer see the same word for the same state.

| Domain state | Badge word | Tone | First reachable |
| --- | --- | --- | --- |
| Ticket or commerce order awaiting Stripe | Processing (new key; orders no longer show "Pending") | warning | T10 |
| Checkout outcome uncertain | Checking payment | warning | T14a |
| Stripe paid and fulfilled | Paid | success | exists |
| Free and fulfilled | Free | success | T13 |
| Checkout not completed or expired | Expired | neutral | exists |
| Failed | Failed | danger | exists |
| Paid but not fulfilled (compensation) | Payment review | warning | T10 |
| Refund requested or processing | Refund processing | warning | T18a |
| Refund confirmed | Refunded | neutral | T18a |
| Free purchase cancelled | Cancelled (long form "Cancelled – free purchase") | neutral | T18c |
| Dispute open | Disputed | warning | T18b |
| Ticket valid / checked in / void / under review | Valid / Checked in / Void / Under review | success / success / neutral / warning | T19a |
| Event sales closed / sold out | Sales closed / Sold out | neutral | T11b |
| Event visibility | "Link only", "Members only" as plain text beside the badge | none | T11b, T24b |
| Membership active / upcoming / expired / revoked | Active / Upcoming / Expired / Revoked | success / accent / neutral / neutral | T23 |
| Pickup pending / ready / collected | Preparing / Ready to collect / Collected | neutral / accent / success | T28 |

Pickup and payment are always two separate badges. Buyer page headings may say "Tickets confirmed" or "Free registration confirmed"; badges use the words above.

**Action copy** (UX §5.4, adjusted to the implemented redesign): Buy tickets, Pay $X.XX, Get free tickets, Confirm free registration, Continue as guest, Buy membership, Get free membership, Renew for {term}, Join society, Leave society, Add to basket, Checkout merchandise, Publish event, Close sales, Reopen sales, Refund whole order, Cancel free purchase, Mark ready, Mark collected, Record a return, Review suggested changes, Confirm action. The payment return page keeps "Checking payment status".

## 4. Design system plan

### 4.1 Three design rounds

As in the October redesign, new screens are designed on the "Thunderstrux redesign" canvas (`https://claude.ai/artifact/M5pCk31AzUpcd1KmfFmfWc`) from the "Thunderstrux UI" design system (`https://claude.ai/artifact/GPCGcK53C7Uq9G4fSsGiHh`) and approved before the UI PRs they feed. Artboards show only data the model will hold, with every state from UX §14.3 for transactional screens.

| Round | Before | Artboards (desktop and phone) |
| --- | --- | --- |
| A (whole) | T11b onward | Event builder with readiness panel, money and society-zone time fields, visibility and capacity; event Summary readiness and sale state; events list with visibility and sale columns; public event detail in each PUB-03 variant (paid open, free only, mixed with payments unavailable, sold out, sales closed, unlisted, draft preview); Explore events with filters and empty state; checkout page (member paid review, free confirmation, guest email step, price-changed 409, "We couldn't confirm" state); purchase status in every projection; guest recovery; Purchases list and ticket order detail; My tickets with ticket faces; Payments page with charges versus payouts and the fee example; refund and free-cancellation dialogs and order states; phone check-in console with valid, already checked in, void, under review and unknown results |
| B: memberships and merchandise | T22 UI | Society profile tabs; membership offer cards, review, status and My memberships; membership plans editor and roster; public shop, product with variant pickers, basket, review and pickup status; organiser products, variants and stock; pickup queue and return; unified Orders with family tabs |
| C: operator experience | T32 | Analytics tabs with tiles, bars and tables; calendar month, week and agenda; completed society and personal overviews (C1, pass 1 approved 19 Oct 2026); History timeline (C2, before T38). OpenClaw is deferred and has no artboards |

#### Round A, split by when each screen is needed

Round A is too large to review before T11b, so it runs as **A1** (screens T11b and T13 need, now) and **A2** (screens Wave 2 and 3 need: public detail variants for T15a, Explore events, guest steps, Payments page, Purchases, ticket faces, refunds, check-in; run it while T11b and T13 are built).

**A1, pass 1 (core, desktop and phone):**
1. **Event builder:** Details (title, description, location, hero image upload with preview, replace and remove), Schedule (start, end, sales close, with the society's zone named, e.g. "Brisbane time"), Tickets (dollar prices, remaining, sold and held per type, add and remove), Access (Public or Link only; optional capacity), one Save with an unsaved-changes guard.
2. **Event Summary:** readiness checklist (each blocker with a Fix link), sale state with Close sales and Reopen sales, the disabled Publish reason, and the hero image.
3. **Checkout page** (`CheckoutShell`, "Booking for {society}", money summary): paid review ending in "Pay $X.XX", and free confirmation ending in "Confirm free registration".
4. **Buy box and hero on the public event page and event cards:** free, paid and mixed types, "Get free tickets" versus "Buy tickets", and a card with and without a hero image.

**A1, pass 2 (remaining states):**
5. **Builder errors:** a daylight-saving gap or overlap time, sales close after the end, a stale version ("This event changed… Reload", keeping edits), stock moved by sales (the T12 409), hero upload too large or the wrong type.
6. **Events list** with visibility ("Link only") and sale-state badges (Sales closed, Sold out).
7. **Checkout states:** price changed (409, review the new price), "Confirming checkout…" (T14 202), no tickets remaining, sales closed, verify email first.
8. **Free registration confirmed**, with a link to My tickets; My tickets and order detail showing "Free".
9. **New badge words and icons** this needs (Free, Sales closed, Sold out, Link only; image and clock icons), checked against the status vocabulary in 3.2.

Open design questions for pass 1: the hero aspect ratio (proposal 16:9, cropped centre, stored by the existing asset pipeline as WebP), whether the money field shows "AUD", and whether sales close defaults to the start time visibly or only when left blank.

After each block that adds or changes a `components/ui/` primitive or a token, run `/design-sync` so the design project matches the code (`.design-sync/` holds the inputs; only the maintainer can start that skill).

### 4.2 New primitives

Each is introduced by the first PR that needs it and extends an existing file where one fits. No component, chart or date library is added.

| Component | Location | First PR | Reused by | Contract |
| --- | --- | --- | --- | --- |
| `MoneyInput` | `components/ui/input.tsx` | T11b | T17 hint, T22, T24b, T25 | `$` prefix, two decimals, submits cents, label plus hint and error like the other fields (EVT-002) |
| `DateTimeField` | `components/ui/input.tsx` | T11b | T22, T33 | Shows the society zone; server returns DST problems as field errors (EVT-001) |
| `ReadinessChecklist` | `components/ui/readiness-checklist.tsx` | T11b | T17, T22, T25, T34 | Server blockers with Fix links; the Overview "Finish setting up" card moves onto it |
| `LinkTabs` | `components/ui/link-tabs.tsx`, promoted from `event-tabs.tsx` | T19a | society profile, orders families, memberships, merchandise | URL-driven, scroll sideways on phones |
| `FilterBar` | `components/ui/filter-bar.tsx`, extracted from the orders filters | T15b | T23 roster, T29, T38 | GET form, URL parameters, Clear |
| `EmptyState` | `components/ui/empty-state.tsx` | T15b | every new list | One reason and one action; distinct from denied and failed |
| `CheckoutShell` | `components/layout/checkout-shell.tsx` | T13 | T16, T19a status, T24a, T26, T27 | Narrow column, "Booking for {society}", step labels, summary aside; return pages move from AuthShell to it |
| `MoneySummary` | `components/purchases/money-summary.tsx` | T13 | every review and receipt | Lines, total, "Free", fee wording from the server only |
| Buy box | evolves `components/events/public-ticket-purchase.tsx` | T13 | T15a states, T16b guest, T24b member price | One choice, one quantity; each disabled state names its reason |
| `TicketFace` | `components/tickets/ticket-face.tsx` | T19a | wallet, guest orders, order detail | Event, local date, type snapshot, short ticket reference, validity and check-in; no QR |
| `AuditTimeline` | generalises the order history card | T19a | commerce order detail, T38 History | Actor, action, time and safe facts; one `<section>` |
| `MembershipOfferCard`, membership status | `components/memberships/` | T24a | profile, My memberships | Free join and paid membership never share a button or badge |
| `MerchProductCard`, `VariantPicker`, basket panel | `components/merchandise/` | T26 | catalogue, product, basket | Labelled radio groups; "Pickup only" visible before payment |
| `MetricTile`, `BarChart` with matching table | `components/analytics/` | T32 | event Summary, T34 | CSS/SVG bars; every chart has the same data as a table |
| `CalendarGrid`, `Agenda` | `components/calendar/` | T33 | — | Agenda is the phone default and the accessible equivalent |
| `ActionPreview` | `components/openclaw/` | Deferred with OpenClaw | — | Not built until OpenClaw is scheduled |
| Icons | `components/ui/icon.tsx` | as needed | — | Add only what a screen uses (for example store, badge, chart, history, clock, sparkle) |

A shared responsive table component is extracted only in T29, when three proven tables (orders, roster, pickups) show its real shape.

### 4.3 Navigation end state

Items appear only when their destination exists ([UI Architecture Rules](obsidian/UI%20Architecture%20Rules.md)); this is the order they will take.

| Shell | End state | Arrives with |
| --- | --- | --- |
| Society sidebar | Overview, Events, Calendar, Orders; **Community:** Memberships (tabs Plans and Members), Merchandise (tabs Products and Pickups); **Insights:** Analytics, History; **Settings:** Society profile, Staff, Payments, Email delivery | Calendar T33, Memberships T22, Merchandise T25, Analytics T32, History T38 (OpenClaw deferred) |
| Personal shell | Overview, My tickets, Memberships, Societies, Purchases, Account | Purchases T19a, Memberships T24a |
| Header | Explore events moves from `/` to `/events` | T15b |
| Public society profile | Link tabs Overview, Events, Memberships, Merchandise; a tab shows only when the society has published content of that kind | T24a (first second tab), T26 |
| Event workspace | Summary, Attendees, Orders, Edit stay; readiness lives in Summary, check-in in Attendees, analytics in Summary | — |

### 4.4 Rules every new page follows

One `h1` through PageHeader; the shell is composed in the page after its guards; data read after the guards streams behind a Skeleton in `<Suspense>`; no route-level `loading.tsx` on protected routes; results are inline Notices with `role="status"` or `role="alert"` only for action results; ConfirmDialog for anything irreversible; StatusBadge for every status; tokens only, no raw palette classes; table from 768px and cards below; repeated row actions name their target; money through `formatMoney` and "Free"; dates in the society zone with the zone named where it matters. Each UI PR is checked in the dev stack at 390, 768 and 1280px against its artboards (restart the app container first on Windows), with screenshots in the PR.

## 5. Delivery sequence

Each block lists scope, schema, UI, tests and validation. The readiness plan's task text is the acceptance contract; these blocks only say how the work is cut and wired.

### How waves run (revised 16 October 2026)

A wave is a batch of work, never one PR. Inside a wave every task is its own PR, fully validated and merged before the next starts, because most tasks depend on the one before and each high-risk PR costs about 45 minutes of baseline, browser and operations runs. T10 (#68) took one session at roughly 600 lines. On that evidence the original nine waves were re-cut so none mixes unrelated risk areas or waits on a design round halfway through:

| Wave | PRs, in order | Starts after | Status |
| --- | --- | --- | --- |
| 1a. Ticket foundations, backend | T10, T11a, T12, T14a, T14b | — | Complete: T10 (#68), T11a (#70), free-ticket gate (#72), T12 (#73), T14a (#74), T14b (#75) |
| 1b. Ticket screens | T11b, T13 | Wave 1a and design round A | |
| 2a. Payment trust and public pages | T17, F1, T15a, T15b | Wave 1b (F1 brought forward) | F1 in review |
| 2b. Guest checkout | T16a, T16b, T16c | Wave 2a | |
| 3. Refunds and attendee experience | T18a, T18b, T18c, T19a, T19b | Wave 2b | |
| 4. Commerce and memberships | T20, T21 with T22, T23, T24a, T24b | Wave 3 and design round B | |
| 5. Merchandise | T25, T26, T27, T28 | Wave 4 (T25 may start after T20) | |
| 6a. Unified orders and email | T29, T30 | Wave 5 | |
| 6b. Analytics, calendar, dashboards | T31, T32, T33, T34 | Wave 6a and design round C | |
| 7. OpenClaw | T35, T36, T37a, T37b | Deferred by the maintainer (19 Oct 2026) | Not scheduled; later waves don't wait for it |
| 8. Hardening | T38, T39, T40, T41, T42 | Wave 7 | |
| 9. Release qualification | T43a–c, T44a–d, T45, T46 | Wave 8, hosting and provider credentials | |

The task blocks below keep their original wave headings; the table above decides order.

### Wave 1: ticket foundations (Package 4 with T14)

**T10 (one PR, `codex/t10-purchase-snapshots`): purchase snapshots and ticket validity.** The write and read halves below ship together: recording the buyer at purchase immediately changes what order detail must say, so splitting them would leave main inconsistent.

*Schema and writes*
- Migration `ticket_purchase_snapshots`: enums `PaymentKind` (stripe, free) and `TicketValidity` (active, void, refund_review). Order gains `paymentKind` (required with **no default**, so every code path that creates an order must state its kind and a forgotten free path cannot be counted as cash), `fulfilledAt`, `purchasedTicketTypeName`, `sellerName`, `sellerStripeAccountId` (used by T17), `currency` (default aud), `feeAmount`, `feePolicyVersion`, `snapshotVersion`. Ticket gains `validity` (default active), `validityReason`, `validityChangedAt`, `issueSequence` with unique `(orderId, issueSequence)`.
- Paid checkout writes the snapshots and the buyer capture at order creation, with provenance `purchase`; the migration widens `Order_buyer_capture_check` to accept it. Closure already skips captured orders and the trigger keeps captures immutable. Fulfilment sets `fulfilledAt` and issue sequences 1..n.
- Backfill only known facts: `paymentKind = stripe` for every row; `fulfilledAt` from the first issued ticket of each paid order; legacy issue sequences by `(createdAt, id)` within each order after an audit query confirms no order has more tickets than its quantity. Names, seller and fee stay null, meaning unknown.
- `pnpm db:integrity:audit` gains checks that fulfilled orders carry `fulfilledAt` and that issue sequences are unique and within quantity; `config/schema-contract.json` names the new migration.
- Validate (High): baseline, E2E, `pnpm ops:test`.

*Snapshot reads everywhere*
- Grouped orders, order detail, `/tickets`, ticket email, check-in list and order timeline read the snapshots; a null name shows the current name plus "(historical label unavailable)" and is never written back. Live event date and place are shown apart from purchase facts. Counts of valid or sold tickets filter on `validity = active`.
- Adds `lib/purchases/projection.ts` for ticket orders and the "Processing" and "Payment review" badge words.
- Validate (High, shared payment reads): baseline, E2E.

**T11a: event policy, readiness and explicit publish (services and API)**
- Migration `event_policy`: Event `capacity` (nullable, positive), `visibility` (public, unlisted, members_only; default public), `salesCloseAt` (backfilled from `startTime`, then required), `saleState` (open, closed), `version`. No capacity backfill.
- `lib/events/event-readiness.ts` replaces the ad hoc reasons in `listDashboardEvents` and `getDashboardEvent`. Create always drafts (EVT-003). `PATCH /api/events/[id]/publish` takes `{ targetStatus, version }`: the same target is an idempotent 200 and a stale version a 409. New `PATCH /api/events/[id]/sales` closes and reopens sales. Edit takes `version`. `members_only` cannot be published until T24b. Event routes move to `mapRouteError`.
- Validate (High): baseline, E2E, `pnpm ops:test`.

**T11b: event builder and readiness UI** (after Round A)
- The form becomes Details, Schedule (start, end, sales close in the society zone), Tickets (dollar entry, sold and held shown per type), Access (Public or Link only; Members only stays hidden until T24b; optional capacity), an optional hero image (migration `event_hero_image`: `Event.heroAssetId` with a same-tenant composite reference to an `event` Asset; reference-gated delivery and delayed cleanup as for society images; shown on the public page and event cards), plus the existing compensation card. Readiness checklist in Summary and beside Publish; Close and Reopen sales in the More menu; the list shows visibility and sale state.
- Explicit Save with a `beforeunload` guard; a version conflict keeps edits and offers reload, as the society profile does. Adds `lib/time/zoned.ts`, `parseMoneyInput`, `MoneyInput`, `DateTimeField` and `ReadinessChecklist`. The PR lists existing dev events whose stored times came from server-time parsing; they are corrected by hand, not rewritten.
- Validate (Standard UI, High for time conversion): unit tests for DST edges (Australia/Sydney), integration round trip, E2E builder journey, visual check.

**T12: inventory and capacity locks, sold-edit safety**
- `lib/events/inventory.ts` (lock helper, sellable, capacity check) is applied to checkout creation, fulfilment, reservation expiry and stale cleanup, and every event edit, publish, sales and delete path. Event edits now run in a locked transaction.
- Remaining stock cannot drop below that type's active holds; capacity cannot drop below valid issued plus active holds; used types still cannot be deleted. Checkout sends `expectedUnitPrice`; a different locked price is a 409 `quote_changed` with the new price before any hold. Quantity is capped at 10 per order for paid and free tickets.
- Under the lock checkout also rechecks publication, sale state and close time, and takes sold-out and payment eligibility from `eventReadiness` instead of its own copies. Hold predicates use one application-clock reading per transaction (the suite drives expiry with fake timers; decided during T12). The stale-order worker's unused SKIP LOCKED helpers are wired in or deleted. The event-edit capacity `shortcut:` comment from T11a is removed. Because remaining stock is an absolute number that sales decrement, an existing type also sends `expectedQuantity` (the quantity the editor loaded): an untouched field keeps stock sold since, a changed one on moved stock is a 409.
- Public reads use the same sellable function without locks.
- Validate (High): baseline, E2E, concurrency suite (two types racing for the last seat under capacity; edit, close and reprice against checkout and webhook in parallel; bounded retries; no negative stock).

**T14a: idempotent checkout attempts**
- Migration `checkout_attempts`: `CheckoutAttempt` per database spec §6.1 (family, actor kind and id, client key, request hash, order, provider operation key, Session id and URL, state, due time), unique per actor, family, operation and key.
- The buy box sends a key per purchase intent, reset when the selection changes. Stripe is called outside the transaction with the provider operation key as Stripe's idempotency key; attachment stays a second fenced transaction. A timeout or unknown error leaves the attempt `provider_uncertain` with its hold and returns 202 with the attempt id; `GET /api/payments/checkout/attempts/[id]` serves its status to its owner. A webhook that arrives before attachment converges.
- Validate (High): baseline, E2E, failure injection (lost response, attach failure, double click).

**T14b: uncertain Session recovery worker**
- `scripts/process-checkout-attempts` replays `sessions.create` with the same key (Stripe returns the original Session for 24 hours, far beyond the 30-minute hold), then attaches, expires or hands over to compensation. Never a new key. Leased like the existing workers; added to the Compose worker and operations profiles, a `pnpm` script and [Production Operations](obsidian/Production%20Operations.md).
- Checkout stores the exact Session request on the attempt before calling Stripe (an additive `providerRequest` column, migration 38), because Stripe only replays a request with identical parameters.
- Validate (High): baseline, `pnpm ops:test`.

**T13: free tickets**
- Turns on `FREE_TICKETS_ENABLED` and splits every `status = paid` read listed in section 2 by `paymentKind`, with a regression that a free order adds no revenue.
- `lib/payments/free-ticket-issuance.ts`: one serializable transaction locks User, Event and TicketType, records a completed attempt, creates the Order (`paymentKind = free`, `status = paid`, `paidAt = fulfilledAt = now`, totals and fee 0), issues tickets with sequences, decrements stock once, appends a new `free_fulfilled` lifecycle event and inserts the automatic ticket email. No Stripe call and no hold row. The checkout adapter dispatches on the locked price; the response is `{ kind: "free", orderId }` or `{ kind: "stripe", url }`.
- Introduces `/events/[eventId]/checkout` in `CheckoutShell` with `MoneySummary`: Get free tickets leads to Confirm free registration; paid selections go through the same review to Pay $X.XX. The email and wallet show "Free"; money metrics exclude free orders until T31 replaces them.
- Validate (High): baseline, E2E (replay, payload mismatch, last seat, no Stripe keys configured, outbox rollback, members-only denial).

### Wave 2: payment trust, public pages and guests (Packages 5 and 6)

**T17: Connect safety and fee disclosure**
- The webhook checks the destination against `Order.sellerStripeAccountId` and the key mode; live keys are refused outside production configuration. Disconnect needs MFA and is blocked while the account has pending orders or unresolved compensation (T18 adds refunds and disputes); it never deletes the Stripe account, and reconnecting leaves history on its snapshot account. Connect mutations are audited; Connect routes move to `mapRouteError` with safe messages.
- Payments page: "Can take payments" and "Can receive payouts" as separate rows with their next action, and a fee card with a worked example ("A $20.00 ticket: the buyer pays $20.00; Thunderstrux keeps $2.00; your society receives $18.00 before Stripe's own fees"). The builder price hint and checkout review use the same wording.
- Validate (High): baseline, E2E.

**F1: one live-staff authority helper (AUTHZ-001)**
- One database-only helper for routes and workers, keeping each caller's guard order, with a denial regression per former copy.
- Validate (High): baseline, E2E.

**T15a: anonymous event pages and honest availability**
- `proxy.ts` drops `/events/:path*` and the organisation-account redirect. The detail page reads one public service: public and unlisted are readable, `members_only` is a concealed 404 until T24b; each type shows its sale state (Free, Sold out, Sales closed, Paid checkout unavailable, Sign in or verify) from readiness and advisory sellable; price or Free, organiser link, support email and refund policy come from the public society DTO. No writes on read paths.
- `/dashboard/events/[eventId]/preview` (events:read) renders the same component with a "Draft preview" banner and no buy action; the workspace header gains Preview.
- Layout from Round A: two columns from `lg` with a sticky ticket panel; on phones the buy box follows the summary, with a "Get tickets" anchor under the title.
- Validate (High, proxy): baseline, E2E (anonymous HTML, login callback, mobile overflow), visual check.

**T15b: Explore events**
- `/events` with title search, date presets (Upcoming, This week, This month, custom up to 366 days), society filter and cursor pages, all in the URL. Lists exclude drafts, unlisted, members-only and ended events (PUB-001). The home page keeps a short upcoming list. Adds `FilterBar` and `EmptyState`.
- Validate (Standard): integration, E2E, visual check.

**T16a: guest email verification and access sessions**
- Migration `guest_access`: `GuestIdentity`, `GuestAccessGrant` (purpose, digest, expiry, consumed and revoked times, purchase scope, session digest) and `Order.guestIdentityId`; the buyer capture check also accepts provenance `verified_guest`.
- `POST /api/guest/email/request` returns a generic response behind fail-closed Redis IP and email limits and queues an encrypted notification; `POST /api/guest/email/confirm` redeems a fragment link through the existing account-link capture into an HttpOnly, Secure, SameSite cookie bound to a hashed session row with its own CSRF token. Every guest view is no-store.
- Validate (High): baseline, E2E, `pnpm ops:test`.

**T16b: guest checkout and receipt recovery**
- Checkout accepts a verified member or a live guest session (actor kind guest). Guests buy public or unlisted standard-price tickets, free or paid; never memberships, member prices or members-only events.
- For guest orders the email worker mints a fresh purchase-scoped grant at send time, so no raw token is stored; a retry mints another short-lived one. `/guest/recover` sends per-purchase links; redemption opens `/guest/orders/[orderId]`. An order or Session id alone never grants access.
- Buy box: Continue as guest and Sign in for eligible types; the email step lives in CheckoutShell.
- Validate (High): baseline, E2E, visual check.

**T16c: explicit member claim**
- A signed-in verified member who also holds a guest session for the same verified email can choose "Add to my account": a locked transaction sets `Order.userId`, keeps the buyer capture and audits it. Signup never claims anything.
- Validate (High): baseline, E2E.

### Wave 3: refunds and attendee experience (Package 7)

**T18a: whole-order refunds with a shared financial fence**
- Migration `purchase_refunds`: `RefundRequest` (typed purchase reference, provider ids, amount, currency, actor, reason, operation key, status, lease, times), a provider refund journal with unique provider refund ids and fee reversal, `Order.stripePaymentIntentId` and a fence column.
- `POST /api/orders/[orderId]/refunds` (orders:refund, live MFA, reason, typed confirmation) locks the Order, checks the fence against compensation and other refunds, records the request, calls Stripe outside the transaction with `reverse_transfer` and `refund_application_fee` and the stable key, then confirms: tickets void with history kept, lifecycle, refund notice. Pending becomes "Refund processing"; an unknown outcome is polled before any retry. Refund webhooks dispatch by verified provider identity to ordinary refunds or existing compensation. The manual flag is relabelled "Recorded outside Thunderstrux". Order routes move to `mapRouteError`.
- Order detail: Refund whole order opens a ConfirmDialog naming the consequences (tickets void, attendance kept, stock not restored) with reason and authenticator code.
- Validate (High): baseline, E2E, `pnpm ops:test`, concurrency (refund against compensation and late fulfilment).

**T18b: disputes, dashboard refunds, PAY-001 and TEST-001**
- `PurchaseDispute` and signed `charge.dispute.*` handling: a verified charge moves tickets to `refund_review` and blocks financial actions until an audited resolution. External and partial refunds are projected and flagged for review, never treated as full. Adds the PAY-001 mismatch branch and the TEST-001 direct cases.
- Validate (High): baseline, E2E webhook spec.

**T18c: cancel free purchases (tickets)**
- The readiness plan §3.3 shape, built for reuse by T23 and T28: orders:refund, MFA and reason; idempotent; `cancelledAt`, actor and reason on Order; tickets void; lifecycle, audit and cancellation notice; no refund rows or totals; stock restoration stays a separate reviewed action.
- Validate (High): baseline, E2E, `pnpm ops:test`.

**T19a: Purchases, order status and the wallet**
- `/purchases` (personal nav Purchases) lists every own ticket order with its projection; `/purchases/tickets/[orderId]` shows units, a timeline excerpt and support; a scoped status read supports bounded polling. `/success` and `/cancel` show the real projection to the owner or guest grant and never fulfil in production. `/tickets` gains Upcoming, Past and Not valid tabs with a TicketFace per unit. Adds `LinkTabs` and `AuditTimeline`.
- Validate (High, payment UI and private scope): baseline, E2E, visual check.

**T19b: check-in console**
- Scoped search by name, email, order or ticket reference; validity enforced in the check-in service with exact reasons; "Already checked in at {time} by {name}"; on timeout "Status unknown – reload ticket" re-reads instead of claiming success. The check-in cursor folds into the shared helper; ticket routes move to `mapRouteError`. Full-width phone layout with a large search field and a high-contrast result card.
- Validate (High): baseline, E2E, phone visual check.

### Wave 4: commerce and memberships (Package 8)

**T20: commerce orders and history (no UI)**
- Migration `commerce_orders`: `CommerceOrder`, `CommerceOrderLine`, `CommerceLifecycleEvent` per database spec §7, tenant-composite references where Prisma allows, checked arithmetic, and one-of commerce references on `CheckoutAttempt`, `RefundRequest` and `CompensationRefundJob`. `lib/commerce/` orders, lifecycle and buyer/finance DTOs; `GET /api/commerce/orders/[id]` with family scoping and concealed foreign targets.
- Validate (High): baseline, `pnpm ops:test`.

**T21: commerce checkout dispatcher and compensation**
- `/api/payments/checkout/membership` and `/merchandise` on checkout attempts; Session metadata carries `family`; the webhook resolves by the unique Session or attempt, verifies amount, currency, fee and destination, then calls the family's locked fulfilment hook. Sessions without `family` stay tickets; a mismatch is ignored with an alert, never re-routed. Free totals complete synchronously. Expiry and attempt workers cover commerce.
- Validate (High): baseline, E2E webhook spec, `pnpm ops:test`.

**T22: membership plans** (after Round B; may run beside T21)
- Migration `memberships`: `MembershipProduct` and `MembershipGrant`.
- `/dashboard/memberships` (memberships:manage), Plans tab: draft, edit, publish and archive; Semester 1, Semester 2 and Full year presets fill exact start and end in the society zone; dollar price; ReadinessChecklist publish review (charge readiness only for paid plans). Sold terms are immutable; the next term is a new plan.
- Validate (High): baseline, `pnpm ops:test`, visual check.
- Built (17 Oct 2026): the membership commerce family is not registered in T22, because registering it without grant fulfilment would sell a membership that grants nothing. T23 registers it with its fulfilment, locks the Organisation before reading a plan (plan lock order User, Organisation, plan) and sets `CommerceOrderLine.membershipProductId`.

**T23: grants, renewal, roster and revocation**
- Grants come only from a verified paid webhook or a free completion, under User then Organisation locks, one per line, with overlap refused. State is computed from `[startsAt, endsAt)` and `revokedAt`. Renewal buys the next non-overlapping term. Exceptional revocation needs a reason, MFA and audit; a full refund or free cancellation revokes the source grant. Membership receipt intent.
- Members tab (members:read): Active, Upcoming, Expired and Revoked filters, with free joins shown separately.
- Validate (High): baseline, E2E.
- Split (18 Oct 2026), like T18: **T23a** registers the membership family, grants from webhook or free checkout with overlap refused, the receipt, grant state, renewal by the next plan, and the Members tab with member detail. **T23b** adds the exceptional revoke, cancelling a free membership and the leave-keeps-grant regression. **T23c** adds a full commerce refund of a paid membership order (the T18a refund machinery extended to commerce orders; the commerce `RefundRequest` and `CompensationRefundJob` references move here from T21), revoking the grant on confirmation; split from T23b on 18 Oct 2026 because it is T18a-sized and is the same path T28 merchandise refunds reuse.

**T24a: membership offers, purchase and My memberships**
- Society profile link tabs (Overview, Events, Memberships); offer cards with term, price or Free, benefits, refund policy and "Renewal is manual"; review in CheckoutShell; `/memberships` (personal nav Memberships) with state tabs; "Joined" and "Member until {date}" as different badges on the profile and the joined list.
- Validate (Standard and High): baseline, E2E, visual check.

**T24b: member prices and members-only events**
- Migration `ticket_member_price`: `TicketType.memberPrice`; Order snapshots of the grant, price basis and entitlement version. The live grant is checked when the hold starts and snapshotted under lock; ordinary expiry during a valid hold keeps the quote; a refund or revocation before fulfilment goes to compensation. Members-only publication opens and every listing and public API conceals it. The buy box shows public and member price rows with eligibility and a link to the offer.
- Split (18 Oct 2026): **T24b1** member prices (schema, checkout under locks, fulfilment check, builder, ticket box) and **T24b2** members-only events (publication, the gate, listings and APIs), each its own PR.
- **Members-only gate (round B1, changed 17 Oct 2026; replaces the concealed 404 on the detail page only):** opening a published members-only event without access shows "Members-only event" naming only the society (public name, slug, logo), with Sign in or See memberships; drafts, deleted events and wrong ids stay 404. Safety contract: the gate decision reads only id, status, visibility and society, and no other event field is loaded for a gated viewer (so nothing reaches HTML, RSC payload or metadata); access is checked live per request (verified user, unrevoked grant of that society, inside its dates, carrying the members-only entitlement; free joins, staff, guests and other societies' members don't count); generic title, no description or preview image, `noindex`, `Cache-Control: private, no-store`; Explore, home, search, society Events tab, calendar and public event APIs exclude it; ticket and checkout APIs refuse without details and checkout re-checks under lock. Tests use sentinel title, description, place and ticket name and assert their absence from the full gated response for every non-entitled viewer (signed out, unverified, free join, expired, upcoming, revoked, wrong entitlement, other society's member, guest), plus listing/API exclusion, headers and the 404 for a missing id. The readiness plan's T24b wording ("conceals") is updated in the T24b PR.
- Validate (High): baseline, E2E, `pnpm ops:test`.

### Wave 5: merchandise (Package 9)

**T25: catalogue, images and variants** (may start after T20)
- Migration `merchandise_catalogue`: products (draft, published, archived; pickup text), same-tenant image assets, variants (tenant-unique SKU, size, colour, price, remaining, version, archived time).
- `/dashboard/merchandise` (merchandise:manage), Products tab: editor reusing the society image upload, a variant table with dollar prices, publish review. No shipping wording.
- Validate (High): baseline, `pnpm ops:test`, visual check.
- Built (18 Oct 2026), decisions made against Shopify, Eventbrite and Humanitix add-ons: SKUs optional to type (generated, still society-unique); a photo required to publish; alt text derived from the product name; pickup details one society-wide field (no per-product pickup text); archive reversible (Restore as draft); options of a product once on sale stop selling instead of being deleted; publishing allowed with free options in stock before payments, as for ticket types.

**T26: public shop and quoted basket**
- Society Merchandise tab, product page with labelled radio variant pickers, a per-society basket kept in browser storage as variant ids and quantities only, re-quoted on every view through `POST /api/merchandise/quote` (lines, totals, availability, pickup and refund policy, quote version). Ten lines of up to ten units, duplicates merged, one society; switching society asks to finish or clear.
- Validate (Standard): integration, E2E, visual check.

**T27: holds, free and paid sale, stock**
- Migration `merchandise_reservations`. Variant locks ascending, then the commerce order; 30-minute holds; the webhook confirms every line once; free totals complete locally; expiry and failure release; late payment goes to compensation; stock edits cannot go below holds. Receipt with pickup details.
- Validate (High): baseline, E2E, `pnpm ops:test`.
- Split (19 Oct 2026) by layer, like T20/T21 and T23a/T24a: **T27a** the migration (`merchandise_sale`: `CommerceOrderLine.merchandiseVariantId`; holds derived from pending, unexpired Stripe orders rather than a `MerchandiseReservation` table, so they can't drift from their order), the merchandise family for free and paid baskets, holds subtracted in the shop and quote, stock edits refused below holds, late or lapsed payments to review, and the receipt; no pages. **T27b** the checkout review page (member or verified guest), the order page with its poller and guest access to the order status read, and the basket's checkout button (`MERCHANDISE_CHECKOUT_ENABLED`). A free/paid cut was considered and rejected: holds exist only for paid orders and the paid path is T21's shared machinery, so a free-only PR would ship unreachable hold code.

**T28: pickup, returns and refunds**
- Migration `merchandise_fulfilment`: pickup state (pending, ready, collected) with actor, time, version and history; returns and stock movements with unique operation keys.
- Pickups tab (merchandise:fulfil): Awaiting preparation, Ready, Collected, Needs review; Mark ready and Mark collected are version-checked and email only from committed transitions; a reviewed return restocks once; refunds use the T18a commerce path and free cancellation the T18c shape.
- Validate (High): baseline, E2E, `pnpm ops:test`, visual check.
- Split (19 Oct 2026): **T28a** pickup states, the Pickups tab, version-checked Mark ready and Mark collected and their emails (migration `merchandise_pickups`: `CommerceOrder.pickupStatus`, history events; staff steps bump the order's existing version); **T28b** returns that restock once, refunds through the T23c commerce path and free cancellation (money and stock). Guest merchandise order links (#108) were brought forward from T29.

### Wave 6: integrated experience (Package 10)

**T29: unified Purchases and Orders.** Family tabs on `/purchases` and `/dashboard/orders` (Tickets, Memberships, Merchandise), typed pagination merged on `(createdAt, id, family)`, per-family detail routes, finance and collection DTOs, ticket URLs preserved. PAG-001 closes; the shared responsive table is extracted here. Validate (High, cross-tenant reads): baseline, E2E, visual check.

**T30: email completion.** Migration `event_changes_and_preferences`: `EventChange` with a resumable fanout cursor for material schedule or place changes to valid holders (deduped on event version, purchase and recipient), and notification preferences (Account settings gains Notifications; optional renewal and engagement mail only). Adds the seven-day renewal reminder with daily catch-up, exhausted-job operator alerts and one test per readiness plan §5 row. Validate (High): baseline, E2E, `pnpm ops:test`.

**T31: authoritative metrics.** `lib/analytics` per readiness plan §6 with database aggregation, ranges up to 366 days, day, week and month buckets in the society zone, zero fill; replaces `event-analytics.ts` and the overview month revenue (PERF-002). Indexes chosen from `EXPLAIN ANALYZE` on synthetic `_test` data (PERF-001 local evidence). Money needs `orders:read` plus `analytics:read`; event managers get attendance and inventory DTOs. Validate (High): baseline plus plan evidence.

**T32: analytics UI** (after Round C). `/dashboard/analytics` with Tickets, Memberships, Merchandise and Engagement tabs; range, bucket and zone in the URL; tiles, bars and the matching table from one DTO; the event Summary reuses them in place of its custom bars. Validate (Standard): build, integration, E2E, visual check.

**T33: calendar.** `GET /api/orgs/[orgSlug]/calendar` (93-day limit, overlap predicate) and `/dashboard/calendar` with Month, Week and Agenda (Agenda below 768px), society-zone day boundaries, drafts only with events:manage, membership terms only with members:read, Create event with the date filled in. Validate (Standard): integration, E2E, visual check.

**T34: dashboards.** Personal overview (valid upcoming tickets, membership coverage, joined societies, recent purchases); society overview tasks for every family (payments, profile, first event, payment review, pickups ready, memberships ending) with honest period labels; a limited landing for check-in-only staff; final check against section 4.3. Validate (Standard): E2E for every role and mode, visual check.

### Wave 7: OpenClaw (Package 11)

> **Deferred (19 October 2026, maintainer decision).** OpenClaw is out of scope until the maintainer schedules it. Build no part of it: no code, schema, migrations, routes, navigation, design artboards or copy, and no other task waits for it. Plans, design rounds, journeys and PRD audits treat it as absent; the requirements below are kept for when it is scheduled. The existing `openclaw:use` permission string in `lib/permissions` is an unused placeholder and grants nothing.

- **T35: action registry.** `lib/actions` holds the nine actions with strict schemas, permissions, tenant resolution, preview and execution through the same services as the UI; reads minimise personal data and respect finance permission. Validate (High): baseline.
- **T36: proposals and receipts.** Migration `action_proposals`: `ActionProposal` and `ActionExecution`; preview, confirm and cancel APIs with origin, CSRF, MFA and limits; ten-minute expiry; mutation, audit and receipt commit together; a replay returns the stored receipt. Validate (High): baseline, `pnpm ops:test`.
- **T37a: workspace and deterministic adapter.** `/dashboard/openclaw` with starters, guided actions, ActionPreview, Confirm or Cancel, and the receipt; fully usable with no model configured. Validate: baseline, E2E, visual check.
- **T37b: real model adapter.** Behind the bounded interface once the provider, model, retention and cost decision is recorded; a local smoke test runs with supplied credentials and is marked blocked otherwise. Validate (High): baseline, injection and invalid-output tests, smoke run.

### Wave 8: hardening (Package 12)

- **T38:** route and action audit matrix and `/dashboard/history` (audit:read) on AuditTimeline. Mostly proving the rows each task already writes; closes AUD-001.
- **T39:** inventory of every route and action (guard order, authority, tenant, body bounds, audit, rate policy); API-001 closes; security headers and CSP tested with Stripe and images; integer bounds; token cleanup.
- **T40:** automated accessibility scans in the Docker browser runner (adds the `@axe-core/playwright` dev dependency, so the dependency audit runs) plus keyboard and screen-reader passes at 390, 768 and 1280px and 200% zoom for every journey; findings fixed or recorded.
- **T41:** integrity audit extended to free, guest, snapshots, validity, refunds, commerce arithmetic, grants, holds, outboxes and receipts; reviewed constraints only after a legacy audit (for example a grant overlap exclusion constraint if `btree_gist` is available on the chosen host); populated upgrade and restore rehearsal.
- **T42:** bounded commands and Compose schedules for every worker, leases, backlog and oldest-age metrics, a local alert capture receiver, and a recovery runbook rehearsal.

### Wave 9: release qualification (Packages 13 and 14)

T43a to T43c, T44a to T44d, T45 and T46 run as the readiness plan orders them. Known blockers to clear early: a hosting provider for T43b, registry credentials for T43c, and real Stripe test, Resend, object storage and model credentials for T45.

### Parallel options

Merges stay sequential, but these pairs touch different files and can be built side by side in separate worktrees: T17 and T15a; T15b and T16a; T22 and T21; T25 and T23; T31 and T33. Design rounds run in parallel with the backend PRs before them.

## 6. Schema roadmap

All migrations are additive. Each schema PR audits existing data first, backfills only known facts with provenance, and updates reset, seed, schema contract and restore verification.

| Order | Migration | PR | Adds |
| --- | --- | --- | --- |
| 35 | `ticket_purchase_snapshots` | T10 | PaymentKind and TicketValidity enums; Order snapshot, fulfilment and seller account fields; Ticket validity and issue sequence; wider buyer capture check |
| 36 | `event_policy` | T11a | Event capacity, visibility, sales close, sale state, version |
| 37 | `checkout_attempts` | T14a | CheckoutAttempt (shipped) |
| 38 | `checkout_attempt_recovery` | T14b | Stored Session request, `checkout_recovery` lifecycle source (shipped) |
| 39 | `event_hero_image` | T11b | `Event.heroAssetId` (decision 6) |
| 40 | `free_ticket_lifecycle` | T13 | `free_fulfilled` lifecycle event |
| 41 | `guest_access` | T16a | GuestIdentity, GuestAccessGrant, Order guest reference, `verified_guest` provenance |
| 42 | `purchase_refunds` | T18a | RefundRequest, provider refund journal, payment intent and fence on Order |
| 43 | `purchase_disputes` | T18b | PurchaseDispute |
| 44 | `free_purchase_cancellation` | T18c | Order cancellation facts and lifecycle events |
| 45 | `commerce_orders` | T20 | CommerceOrder, lines, lifecycle; commerce references on attempts, refunds and compensation |
| 46 | `memberships` | T22 | MembershipProduct, MembershipGrant |
| 47 | `ticket_member_price` | T24b | TicketType member price; Order grant and price-basis snapshot |
| 48 | `merchandise_catalogue` | T25 | Products, images, variants |
| 49 | `merchandise_sale` (planned as `merchandise_reservations`) | T27a | `CommerceOrderLine.merchandiseVariantId`; holds derived from pending orders |
| 50 | `merchandise_fulfilment` | T28 | Pickup state and history, returns and stock movements |
| 51 | `event_changes_and_preferences` | T30 | EventChange with fanout cursor, notification preferences |
| 52 | `action_proposals` | T36 (deferred) | ActionProposal, ActionExecution; not created while OpenClaw is deferred |
| — | reviewed constraints | T41 | Only after the legacy audit |

## 7. Validation

The risk table in the [Engineering Delivery Workflow](obsidian/Engineering%20Delivery%20Workflow.md) decides the checks; each block above names them. In short:

| Change | Checks |
| --- | --- |
| Schema, payment, auth, tenancy or worker change | `node scripts/run-e2e.mjs baseline` (build, typecheck, full integration, audit) and `pnpm test:e2e`; `pnpm ops:test` when a migration, worker or restore path changes |
| UI behaviour with no domain change | typecheck, build, affected integration and browser tests, visual check at 390, 768 and 1280px |
| Documentation only | `pnpm docs:check` and `git diff --check` |

One successful applicable run is enough; rerun only after a failure, a relevant change or a known flaky concern. Record commit, commands, counts, run ids and cleanup (`pnpm test:e2e:cleanup -- <run-id>`) in the PR.

New browser specs grow with the waves and become T44's journeys: `events-builder` and `free-tickets` (Wave 1); `public-events` and `guest` (Wave 2); `refunds` and `check-in` (Wave 3); `memberships` (Wave 4); `merchandise` (Wave 5); `calendar-analytics` and a role matrix (Wave 6); `openclaw` (Wave 7).

### Routine for every PR

1. Refresh `main` from `origin/main`, branch `codex/tNN-<description>`.
2. Write the acceptance note in the PR: outcome, exclusions, risk level, tests, migration and rollback when data or operations change.
3. Implement with focused regressions, fixtures and denial cases; update living documentation in the same PR.
4. Validate by risk; review UI changes in the dev stack against the approved artboards.
5. Second-pass self-review of tenant boundaries, error disclosure, lock order and rollback; clean up run-owned resources.
6. After merge, fast-forward `main`, tick the task in the readiness plan with its evidence, and note a completed package in the readiness plan and Project Handover.

## 8. Documentation in each PR

- Always: the readiness plan task and evidence, [Project Handover](obsidian/Project%20Handover.md) current state and next action, the [issue register](obsidian/Issue%20and%20Defect%20Register.md) for items absorbed or found, API Reference for new routes, Database and Multi Tenancy for schema.
- UI PRs: [UI Architecture Rules](obsidian/UI%20Architecture%20Rules.md), [visual design](THUNDERSTRUX_COMPLETE_VISUAL_DESIGN_SPEC.md) section 16 and [UX specification](THUNDERSTRUX_UX_USER_FLOW_SPEC.md) section 24.
- By subsystem: Event Lifecycle (T11, T12, T15), Payment Lifecycle and Stripe Payments and Connect (T13, T14, T17, T18, T21), Ticket Check-in Implementation (T19b), Email Delivery Implementation (T16, T30 and every task adding a template), Society Profiles and Assets (T24a, T26), Production Operations (T14b, T42, T43).
- New living notes, added to the Documentation Index when created: Guest Access (T16), Memberships and Merchandise (T20–T28), Analytics and Calendar (T31–T33), OpenClaw (T35–T37, when it is scheduled).

## 9. Decisions for the maintainer

Settled 18 October 2026 unless marked otherwise.

1. **T14a before T13.** Done (recorded as a T13 dependency).
2. **Design rounds on the canvas** before each UI block, reviewed in two passes (core screens, then remaining states). UI PRs start only after approval; backend PRs proceed meanwhile.
3. **10 tickets per order**, paid and free. Shipped in T12.
4. **One ticket checkout page** at `/events/[eventId]/checkout` for every ticket purchase (free confirmation and paid review now; guest email step in T16).
5. **One Memberships nav item** with Plans and Members tabs. Default; confirm at round B (T22).
6. **Event hero images: in scope for T11b** (the maintainer chose them over the recommendation). Additive `Event.heroAssetId` with a same-tenant composite reference to an `event` Asset (the asset pipeline already has that kind, guarded by `events:manage`), reference-gated delivery and cleanup like society images, shown on the public event page and event cards.
7. **Explore events at `/events`** (T15b); the home page keeps a short upcoming list.
8. **Legacy unknowns stay null.** Shipped in T10.
9. **OpenClaw** (T35 to T37b): deferred on 19 Oct 2026 by the maintainer, who will decide when to build it. Nothing of it is built meanwhile. The earlier provider default (Anthropic Claude through the official SDK) is revisited then.
10. **Hosting, registry and real provider credentials** (T43b, T43c, T45): still open; needed by Wave 9.

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| Lock inversions as more paths lock Event | One helper, the section 3.1 order, a review grep for raw `FOR UPDATE`, and parallel edit, checkout and webhook tests in T12 |
| A webhook fulfils the wrong purchase family | Typed `family` metadata, unique Session binding, mismatch ignored with an alert, never re-routed |
| Migrations on populated data | Audit queries first, known-fact backfills only, `pnpm ops:test` with populated restore for every schema PR |
| Visual drift across 30 new screens | Design rounds, one StatusBadge, the planned navigation, `/design-sync` after primitive changes |
| Scope creep into enhancements | Section 11 stays out unless separately approved |
| Review load: 52 PRs, most high risk | Small PRs merged in order; independent security and migration review stays a release gate before production activation, not a per-PR blocker |

## 11. Not in scope

From UX §19.2, none of these get controls, routes or schema: personal or public calendars and ICS feeds, waitlists, discount or access codes, per-attendee questions, add-ons and bundles, mixed baskets across kinds or societies, seating, recurring events, QR or barcode check-in and offline scanning, wallet passes, subscription memberships and auto-renewal, multiple simultaneous membership tiers, shipping, door point of sale, bulk marketing, buyer self-service or partial refunds, member-only merchandise prices, external calendar sync, cross-society events and resale.

## 12. First steps

1. Review and merge F1 (`codex/f1-staff-authority`).
2. Confirm or change decisions 2 to 10 and run design round A; Wave 1b (T11b, then T13) follows it.
3. If round A is still pending after F1, T17's backend half (Connect destination checks, disconnect guard, audits) has no design dependency and could be split out first.
