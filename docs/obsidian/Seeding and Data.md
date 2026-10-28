---
status: living
last-reviewed: 2026-10-29
owner: engineering
related: ["[[Development Workflow]]", "[[Database and Multi Tenancy]]", "[[Authentication and Dashboard Access]]", "[[Troubleshooting]]"]
sources: [prisma/seed.mjs, prisma/demo-data.mjs, package.json]
---

# Seeding and Data

**Owns:** the demo data `prisma/seed.mjs` and `prisma/demo-data.mjs` write, how to run them safely, and what a volume wipe removes.
**Read when:** you need local accounts and events, a page looks empty or has too few rows to page, or you are about to reseed or wipe the dev database.
**Not here:** models and tenant rules ([[Database and Multi Tenancy]]); what each role may do ([[Authentication and Dashboard Access#Roles and permissions]]); real backup and restore ([[Production Operations]]); test fixtures (`tests/helpers/test-data.ts`).

## Code

| Concern | Where |
| --- | --- |
| Seed script | `prisma/seed.mjs` |
| Run it | `pnpm seed` (`prisma db seed`, configured as `node prisma/seed.mjs` in `package.json`), `pnpm prisma:seed` (direct), `pnpm docker:seed` (`docker compose exec app pnpm seed`), `pnpm docker:db:sync` (migrate dev, generate, seed) |
| Normal command | `docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app pnpm seed` |
| Rich demo data | `prisma/demo-data.mjs`, run by `pnpm seed:demo` after the base seed: `docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app pnpm seed:demo` |

## Rules

- **Synthetic dev data only.** Run it against an explicitly chosen development or disposable database. It is not a migration, a restore, or a way to reopen or reassign anything.
- **Public origins (SEC-015).** If `AUTH_URL`, `NEXTAUTH_URL` or `NEXT_PUBLIC_APP_URL` names a host other than `localhost`, `127.0.0.1` or `[::1]`, the seed exits before writing unless `SEED_DEMO_PASSWORD` has at least 16 characters; every seeded account then gets that password. On loopback every account uses `password123` (published in the README).
- **Idempotent, and it overwrites.** Rerunning updates rather than duplicates:

| Row | Matched by | Rerun overwrites |
| --- | --- | --- |
| `User` | `email` | password hash, `accountRole`, names, `onboardingCompletedAt` |
| `Organisation` | `slug` | `name`, `accountUserId`, and Payments Lab's Stripe fields |
| `OrganisationMember` | `(userId, organisationId)` | `role` |
| `OrganisationStaff` | `(organisationId, userId)` | `role`, `status` (`active`), `acceptedAt` (now), `revokedAt` (null) |
| `Event` | `(organisationId, title)` | description, times, location, `status`, `salesCloseAt` (= start) |
| `TicketType` | `(eventId, name)` | `price`, `quantity` |
| `Order` | `stripeSessionId` | status, amounts, timestamps; paid orders get exactly `quantity` tickets, others lose their tickets |

- So a rerun resets passwords, re-activates revoked seeded staff and undoes a seeded handover. It never sets `emailVerifiedAt` or clears `closedAt`/`disabledAt`: seeded accounts start unverified (purchases, joins and invites need verification) and a closed account stays closed.
- It creates no profile images, membership plans, products, check-ins or audit rows, and its societies keep incomplete public profiles. For those, load the [[#Rich demo data]] on top.
- Event dates are relative to the day you seed (`futureDate`, `pastDate`), so reseeding moves them.

## Accounts

| Email | `accountRole` | Staff authority (`OrganisationStaff`, active) | Membership rows only |
| --- | --- | --- | --- |
| `engineering.org@example.com` | `organisation` | Engineering Society `owner` | Engineering `org_owner` |
| `arts.org@example.com` | `organisation` | Arts Society `owner` | Arts `org_owner` |
| `robotics.org@example.com` | `organisation` | Robotics Club `owner` | Robotics `org_owner` |
| `payments.lab@example.com` | `organisation` | Payments Lab `owner` | Payments Lab `org_owner` |
| `empty.org@example.com` | `organisation` | Empty Society `owner` | Empty `org_owner` |
| `admin@example.com` | `member` | Engineering `admin` | Engineering and Arts `org_admin` |
| `event.manager@example.com` | `member` | Engineering `event_manager`, Robotics `owner` | Engineering `event_manager`, Robotics `org_owner` |
| `finance@example.com` | `member` | Engineering `finance_manager`, Payments Lab `owner` | Engineering `finance_manager`, Payments Lab `org_owner` |
| `empty@example.com` | `member` | Empty Society `owner` | Empty `org_owner` |
| `user1@example.com` | `member` | none | Engineering `org_owner` |
| `content@example.com` | `member` | none | Engineering `content_manager` |
| `member@example.com` | `member` | none | Engineering `member` |
| `user2@example.com` | `member` | none | Arts `member` |
| `outsider@example.com` | `member` | none | none |

- Authority comes only from `OrganisationStaff` (or, while `LEGACY_ORGANISATION_ACCESS_MODE=allow`, an `organisation` account named on `Organisation.accountUserId`; `lib/staff/live-authority.ts`). Membership roles grant nothing. So `user1@`, `content@`, `member@` and `admin@` in Arts have no management access; the seed's closing console table marks them "no staff role".
- Each organisation account is linked through `Organisation.accountUserId`.
- `outsider@` has no names and no `onboardingCompletedAt`.

## Societies, events and orders

| Society (slug) | Events | Notes |
| --- | --- | --- |
| Engineering Society (`engineering-society`) | Engineering Society Launch Night (published; General Admission $10 ×50, VIP $25 ×5); Engineering Sold Out Mixer (published; one type, quantity 0); Engineering Draft Workshop (draft, one type); Engineering No Ticket Draft (draft, no types) | Holds the paid and failed seed orders. |
| Arts Society (`arts-society`) | Arts Society Showcase (published; Standard $15, Concession $8); Arts Members Draft Critique (draft; free Member Seat) | Holds the pending seed order. |
| Robotics Club (`robotics-club`) | Robotics Build Night (published) | A second tenant's event. |
| Payments Lab (`payments-lab`) | Payments Lab Checkout Test (published) | `stripeAccountStatus = PLATFORM_NOT_READY`, no account, charges off: the platform-setup state without a real Stripe account. |
| Empty Society (`empty-society`) | none | A society with no events. |

No society has a connected Stripe account, so paid checkout fails "Stripe not connected" until one is connected ([[Troubleshooting]]).

| Order (`stripeSessionId`) | Buyer | Status |
| --- | --- | --- |
| `cs_seed_engineering_paid_order` | `user2@` | `paid`, 2 × General Admission, 2 tickets issued, yesterday |
| `cs_seed_sold_out_failed_order` | `member@` | `failed` on the sold-out mixer |
| `cs_seed_arts_pending_order` | `user1@` | `pending`, no tickets |

Seed `cs_seed_…` ids are not real Stripe Sessions; Stripe lookups for them fail. The orders have `paymentKind = "stripe"` but none of the buyer snapshot fields (`buyerEmailSnapshot` and the rest), no `purchasedTicketTypeName` and no checkout attempt, so views fall back to live names and show the ticket type as "… (historical label unavailable)" (`lib/purchases/projection.ts`).

## Quick check

1. `engineering.org@example.com` → `/dashboard` (Engineering) and `/dashboard/orders`: the paid and failed orders.
2. `user2@example.com` → `/tickets`: two tickets for the launch night.
3. `payments.lab@example.com` → `/dashboard/settings`: "Stripe platform setup required".
4. Signed out → `/` and `/societies` list the published events and societies. `/organisations` redirects to `/societies`; `/dashboard/[orgSlug]/orders` redirects to `/dashboard/orders` for staff.

Public pages only read: with no published events the homepage shows its empty state, and nothing creates demo data at run time.

## Rich demo data

`prisma/demo-data.mjs` (`pnpm seed:demo`) adds eight societies, 60 members and 10 guest buyers on top of the base seed, so public pages, member pages, organiser dashboards, the shared `Pager` and analytics show every state with enough rows to page. Run `pnpm seed` first (it uses `member@` and `event.manager@`), then the command in [[#Code]]. A run takes about 15 seconds and ends with a coverage table, the accounts to try and the owners' MFA secrets.

- **Dev database only, no override.** It exits before writing unless `NODE_ENV=development`, at least one of `AUTH_URL`, `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` is set and every one set is loopback, and `DATABASE_URL` names a database not ending in `_test`. Unlike the base seed, `SEED_DEMO_PASSWORD` unlocks nothing: the preview's database has the same name, so `NODE_ENV` and the origin tell them apart.
- **It owns its rows, and a re-run replaces them.** Every demo society has a `demo-` slug and an `<key>.org@demo.example.com` account; members and guests are `@demo.example.com`. A re-run deletes those societies with everything under them (purchases, events, plans, products, staff, invites, audit rows, image rows and their stored bytes), then rebuilds them with dates relative to today. Accounts and guest identities are upserted, so passwords go back to `password123`. Base seed rows and hand-made data in other societies are never touched; what a base account holds inside a demo society goes with it.
- **App services where they fit, rows where they can't.** Images go through `uploadAsset`, profiles through `updateProfile`, owner MFA through the staff MFA enrolment. Purchases are backdated, and the services stamp the current time on rows the database then keeps immutable, so the script writes them in the shapes checkout, fulfilment, refunds and disputes write: snapshots, reservations, tickets, lifecycle history, refund requests, disputes, compensation jobs. `scripts/audit-db-integrity.mjs` finds nothing in demo rows. Before it finishes, the script checks that every promised condition below exists and fails if one is missing.
- **It never calls Stripe, but the app may.** Connected demo societies have fake `acct_demo_<key>` accounts, and charged orders have fake `cs_demo_`, `pi_demo_`, `re_demo_` and `dp_demo_` ids. Opening Settings → Payments for one makes the app ask Stripe, which answers "no such account", so the app marks that society `ERROR` (sales off) and raises an alert. A paid checkout on a demo society fails at Stripe; free checkouts work. A re-run restores it.
- **Time moves.** A fixed random seed gives the same shape every run, but dates follow the run day. A checkout "in progress" holds stock for 14 minutes, then the dev stale-order worker expires it. The refund in progress has its next attempt 30 days out, so a refund worker never takes it to Stripe.
- **Owner MFA.** Film Society's and Debating Society's owners enrol through the app's own begin-and-confirm, and the run prints each secret, `otpauth://` URL and recovery codes. A re-run keeps an enrolled owner and doesn't print the secret again; delete that owner's `UserMfa` row to enrol afresh. Both societies have an admin without MFA.
- Images are circles in each society's colours, with no text: the app image has no fonts for `sharp` to draw with.

| Society (slug) | Owner account | What it shows |
| --- | --- | --- |
| Film Society (`demo-film`) | `film.org@` (MFA) | The flagship. Stripe `READY`, full profile, logo and cover. Staff in every role: admin `ava.nguyen@`, event manager, finance manager `mia.patel@`, check-in `noah.chen@` and `event.manager@example.com`, plus a revoked event manager, a pending invite and an expired one. 46 joins. This year's plan (member prices and members-only events, 33 holders, one refunded), last year's archived plan with 10 ended memberships, and a draft plan. 26 events: 14 published upcoming (free, paid, member prices, four ticket types, members-only, link-only, sold out by ticket type and by event capacity, sales closed, cancelled with refunds, in progress), two drafts (one without ticket types), and 10 past events over eight months with check-ins. Four products and a draft, about 80 merchandise orders across every pickup stage. |
| Climbing Club (`demo-climbing`) | `climbing.org@` | `READY`, cover but no logo. A shop with sizes, colours, a sold-out option, a draft and an archived product; six events including a multi-day trip. |
| Debating Society (`demo-debating`) | `debating.org@` (MFA) | `READY`, logo only, an admin. Memberships active, upcoming (next year's plan already on sale), ended and revoked; members-only events with member prices. |
| Volunteer Collective (`demo-volunteers`) | `volunteers.org@` | `READY`, free events only: registrations cancelled by staff and by buyers, a shift full at its event capacity, check-ins. |
| Chess Club (`demo-chess`) | `chess.org@` | `CONNECTED_INCOMPLETE` (charges off). Profile without a support email, so onboarding isn't complete; a paid tournament that can't sell. |
| Gaming Guild (`demo-gaming`) | `gaming.org@` | `ERROR` (account out of reach): past paid sales with refunds, a won and a lost dispute, a payment in review. |
| Campus Choir (`demo-choir`) | `choir.org@` | `NOT_CONNECTED`, no profile or images, free events. |
| Astronomy Society (`demo-astronomy`) | `astronomy.org@` | Brand new: no profile, events, members or staff. |

- **Members** `<first>.<last>@demo.example.com`: 52 verified with a profile (some with a display name, phone or student number), 4 unverified, 2 fresh sign-ups with no name, 1 disabled and 1 closed. The run prints an unverified, a fresh and a disabled one.
- **Guests** `guest01@` to `guest10@demo.example.com`: verified guest identities that bought tickets and merchandise without an account.
- **`member@example.com`** joins Film, Climbing and Debating, holds Film's current membership and Debating's ended one, and has a Film purchase in every buyer state: paid at the member price, free, refunded, cancelled by the society, refunded by a cancelled event, waiting for payment, didn't complete, a past event, and merchandise ready and collected.
- **Across societies**, ticket orders are paid, free, member-priced, by guests, refunded, mid-refund, disputed (open, won, lost), in payment review, partly refunded outside Thunderstrux, expired, failed, in progress and cancelled; sales run back about nine months.

Quick check: signed out, `/societies/demo-film` shows six events and "See all"; `member@example.com` → `/purchases` shows every buyer state; `ava.nguyen@demo.example.com` with the Film Society workspace → `/dashboard/orders`, `/dashboard/merchandise/pickups`, `/dashboard/memberships/members` (each pages), `/dashboard/analytics` over 90 days (by week) and `/dashboard/settings/staff`.

## What `down -v` removes

- `pnpm docker:reset` (`docker compose down -v`, base file) deletes `postgres_data` and `redis_data`: every user, society, event, order and ticket, plus rate-limit state.
- `docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v` also deletes `node_modules` and `asset_data` (uploaded image bytes). Database metadata and image bytes must be kept together; a seed recreates neither uploads nor any manually added rows.
- Rebuild synthetic data afterwards with `pnpm docker:dev`, then the seed command above (and `pnpm seed:demo` for the demo societies). This is not a restore: real data needs [[Production Operations]] and [[Society Profiles and Assets]].

## Traps

- Don't reseed to "fix" a staff, ownership or closure state you are testing; the seed silently resets seeded staff and passwords.
- Rows you add by hand survive a reseed (the seed only touches its own keys) but not `down -v`.
- `pnpm docker:db:sync` runs `prisma migrate dev`, which can offer to reset the database on drift.

## Related

[[Development Workflow]] · [[Database and Multi Tenancy]] · [[Authentication and Dashboard Access]] · [[Troubleshooting]] · [[Environment Variables]]
