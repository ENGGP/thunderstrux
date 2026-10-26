---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Development Workflow]]", "[[Database and Multi Tenancy]]", "[[Authentication and Dashboard Access]]", "[[Troubleshooting]]"]
sources: [prisma/seed.mjs, package.json]
---

# Seeding and Data

**Owns:** the demo data `prisma/seed.mjs` writes, how to run it safely, and what a volume wipe removes.
**Read when:** you need local accounts and events, a page looks empty, or you are about to reseed or wipe the dev database.
**Not here:** models and tenant rules ([[Database and Multi Tenancy]]); what each role may do ([[Authentication and Dashboard Access#Roles and permissions]]); real backup and restore ([[Production Operations]]); test fixtures (`tests/helpers/test-data.ts`).

## Code

| Concern | Where |
| --- | --- |
| Seed script | `prisma/seed.mjs` |
| Run it | `pnpm seed` (`prisma db seed`, configured as `node prisma/seed.mjs` in `package.json`), `pnpm prisma:seed` (direct), `pnpm docker:seed` (`docker compose exec app pnpm seed`), `pnpm docker:db:sync` (migrate dev, generate, seed) |
| Normal command | `docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app pnpm seed` |

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
- It creates no profile images, memberships plans, products, check-ins or audit rows. Seeded societies keep incomplete public profiles.
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

- Authority comes only from `OrganisationStaff` (or, while `LEGACY_ORGANISATION_ACCESS_MODE=allow`, an `organisation` account named on `Organisation.accountUserId`; `lib/staff/live-authority.ts`). Membership roles grant nothing. So `user1@`, `content@`, `member@` and `admin@` in Arts have no management access, although the seed's closing console table labels `user1@` "Engineering org_owner" and `content@` "Engineering content_manager" (OPS-006).
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

## What `down -v` removes

- `pnpm docker:reset` (`docker compose down -v`, base file) deletes `postgres_data` and `redis_data`: every user, society, event, order and ticket, plus rate-limit state.
- `docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v` also deletes `node_modules` and `asset_data` (uploaded image bytes). Database metadata and image bytes must be kept together; a seed recreates neither uploads nor any manually added rows.
- Rebuild synthetic data afterwards with `pnpm docker:dev`, then the seed command above. This is not a restore: real data needs [[Production Operations]] and [[Society Profiles and Assets]].

## Traps

- Don't reseed to "fix" a staff, ownership or closure state you are testing; the seed silently resets seeded staff and passwords.
- Rows you add by hand survive a reseed (the seed only touches its own keys) but not `down -v`.
- `pnpm docker:db:sync` runs `prisma migrate dev`, which can offer to reset the database on drift.

## Related

[[Development Workflow]] · [[Database and Multi Tenancy]] · [[Authentication and Dashboard Access]] · [[Troubleshooting]] · [[Environment Variables]]
