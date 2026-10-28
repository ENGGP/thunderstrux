---
status: living
last-reviewed: 2026-10-28
owner: engineering
related: ["[[Project Handover]]", "[[Journey Qualification]]", "[[E2E and Staging Payments]]", "[[Production Operations]]", "[[Production Operations Hosting]]", "[[Issue and Defect Register]]"]
sources: [config/schema-contract.json, lib/stripe/fees.ts, lib/stripe/version.ts, lib/payouts/release.ts, lib/payouts/payouts.ts, lib/validators/events.ts, docker-compose.hosted.yml, deploy/droplet/config.env.example]
---

# Pre-hosting Candidate

**Owns:** what would go to hosting (the candidate), its production settings, the fee decision, support and rollback stance, what it leaves out, the gates before real users and real money, and the `thunderstrux.com` go-live checklist.
**Read when:** preparing the first hosted deploy, changing a production default, the fee or a release gate, or deciding whether something blocks real users.
**Not here:** how to deploy, roll back or recover ([[Production Operations]], [[Production Operations Hosting]]); which test proves each journey ([[Journey Qualification]]); provider acceptance runs ([[E2E and Staging Payments]]); each gate's detail and status history ([[Issue and Defect Register]]). Dated qualification evidence: [[Evidence Ledger]] and [[Project Handover]].

It is a candidate, not a release: nothing here claims hosted operation, live payouts, inbox delivery or certified accessibility.

## The candidate

- **Code:** current `main`. CI publishes its web and ops pair; a deploy uses the `release-<revision>` manifest from that commit's Release Images run, verified by attestation ([[Production Operations Hosting]]).
- **Schema:** every migration in `prisma/migrations/`, all additive, applied once from the ops image before the web image rolls out. Readiness requires `requiredMigration` in `config/schema-contract.json`; the manifest records the chain digest.
- **Qualification:** the journey campaigns in [[Journey Qualification]] plus the staging scenarios in [[E2E and Staging Payments]], re-run for whatever a change touches ([[Engineering Delivery Workflow]]).

## Settings

| Setting | Candidate value | Why |
| --- | --- | --- |
| `MFA_ENFORCEMENT_MODE` | `enforce` | Staff money and authority actions need a fresh authenticator code (SEC-001). |
| `LEGACY_ORGANISATION_ACCESS_MODE` | `deny` | Only live staff rows grant authority. |
| `RATE_LIMIT_ENABLED` | `true` (forced in `docker-compose.hosted.yml`), Redis and the edge-set client-IP header | Sign-in, checkout and staff actions are rate limited (SEC-002). |
| `ALERT_WEBHOOK_URL` (secret file) | required | Monitor and payment paths alert through it (OPS-002). |
| `EMAIL_FROM`, Resend key | required | Receipts and notices; inbox delivery needs a verified domain (H03). |
| `PLATFORM_SUPPORT_EMAIL` | optional, unset | Help and Privacy name it once the founder picks an address and owner. |
| Ticket compensation | `automatic_full` default for new events (`createEventSchema` in `lib/validators/events.ts`); a society may choose `manual_review`, the column default for older rows | An unfillable paid ticket is refunded in full by the refunds worker. No real sales until hosted refund webhooks pass (PAY-002). |
| Commerce compensation | always an automatic full refund (PAY-003) | A membership or merchandise payment that can't be filled is refunded by the refunds worker. |
| Fee | `PLATFORM_FEE_POLICY_VERSION` in `lib/stripe/fees.ts`: 3.75% of the order (rounded once) + $0.89 per item, capped at the price | Each ticket is an item; a membership or merchandise order is one. Past orders keep their recorded policy. |
| Stripe API version | `stripeApiVersion` in `lib/stripe/version.ts` (PAY-006) | Hosted webhook endpoints are created on it; the key is a restricted `rk_live_` key ([[Production Operations#Stripe webhook endpoints and keys]]). |
| Society payouts | Connect accounts on a manual schedule; the refunds worker sends payouts (PAY-005), at most one a UTC day (DEF-034) | Constants in `lib/payouts/release.ts`: tickets 2 days after the event ends, memberships and merchandise 7 days after the sale, never held past 80 days. |
| Lost disputes | taken back from the society (PAY-004) | The transfer is reversed by the disputed amount; Thunderstrux keeps its fee and pays Stripe's dispute fee. |

Six jobs run every minute under the worker contract: [[Production Operations#Workers and schedules]].

## Fee review

Stripe charges its processing fee to the platform on destination charges and keeps it when a payment is refunded; a $9.00 test-card payment cost $0.62 (3.5% + 30c, an international card). A flat 10% therefore lost money on small orders and on every refund.

The founder asked for a fee just under Humanitix: its Australian Standard plan is 4% + $0.99 per ticket plus GST (Charities & Schools 2.5% + $0.50); most student societies fall under Standard. The candidate's fee includes GST where it applies, and the society absorbs it, so buyers pay the price shown.

| Sample | Society receives (old 10%) | Society receives (now) | Humanitix fee if absorbed | Platform keeps after Stripe, domestic card | international card |
| --- | --- | --- | --- | --- | --- |
| One $2 ticket | $1.80 | $1.03 | $1.18 | $0.64 (was −$0.13) | $0.60 |
| One $5 ticket | $4.50 | $3.92 | $1.31 | $0.70 | $0.60 |
| One $12 ticket | $10.80 | $10.66 | $1.62 | $0.84 | $0.62 |
| Two $12 tickets | $21.60 | $21.32 | $3.24 | $1.98 | $1.54 |
| $25 membership | $22.50 | $23.17 | $2.19 | $1.12 | $0.65 |
| $55 merchandise order | $49.50 | $52.05 | $3.51 | $1.74 | $0.72 |

- Domestic cost is Stripe's published Australian 1.65% + 30c from 1 October 2026 (was 1.7%; not observed), rounded to the cent ([Stripe AU pricing](https://stripe.com/au/pricing)). International is the observed 3.5% + 30c, published to fall to 2.80% + 30c on 1 April 2027.
- Stripe Connect adds A$2 for each society paid out in a month and 0.25% + 25c per payout ([Stripe Connect pricing](https://stripe.com/au/connect/pricing)). Whether the page's separate 0.25% "funds routing" line is an extra charge is unconfirmed until the first invoice.
- Humanitix column: 4.4% + $1.09 per ticket with GST. It sells no merchandise; that row is comparison only.
- A full refund returns the fee to the society; the platform loses Stripe's cost (about 50c on a $12 ticket).

### Against other platforms

What a society pays per ticket on a one-ticket order when it absorbs the fee, with GST and card processing included. Published Australian plans, checked 2026-10-28.

| Plan | $5 | $12 | $20 | $50 | Published fee |
| --- | --- | --- | --- | --- | --- |
| Thunderstrux | $1.08 | $1.34 | $1.64 | $2.77 | 3.75% + $0.89, GST and processing included |
| [Eventbrite](https://www.eventbrite.com.au/organizer/pricing/), no ABN | $1.60 | $2.02 | $2.49 | $4.25 | 5.35% + $1.19, plus GST |
| [Humanitix](https://humanitix.com/au/pricing) Standard | $1.31 | $1.62 | $1.97 | $3.29 | 4% + $0.99, plus GST |
| [Rubric](http://hellorubric.com/clubs-landing/pricing-au/) Standard | $1.30 | $1.60 | $1.95 | $3.23 | 3.9% + $0.99, plus GST; buyers also pay an unpublished service fee |
| [Ticket Tailor](https://www.tickettailor.com/pricing) pay as you sell | $1.48 | $1.60 | $1.73 | $2.23 | $1.10 a ticket plus Stripe |
| [Eventfinda](https://www.eventfinda.com.au/ticketing/pricing/), organiser absorbs | $1.07 | $1.16 | $1.76 | $2.65 | 1.3% plus a $1 to $5 booking fee by price |
| [Ticketebo](https://www.ticketebo.com.au/pricing) | $1.20 | $1.20 | $1.20 | $2.00 | 4% of the order, at least $1.20, GST included |
| [TryBooking](https://www.trybooking.com/pricing) | $0.63 | $0.80 | $1.00 | $1.75 | 2.5% + $0.50 ($0.15 under $5), GST included |
| Humanitix Charities & Schools | $0.63 | $0.80 | $1.00 | $1.75 | 2.5% + $0.50, GST-exempt, on application |
| A Stripe payment link, no ticketing | $0.38 | $0.50 | $0.63 | $1.13 | 1.65% + 30c |

- Thunderstrux is cheaper than Eventbrite, Humanitix Standard and Rubric Standard at every price.
- On $5 to $50 tickets it costs about 1.6 to 1.7 times TryBooking's 2.5% + $0.50, which anyone can use and which Humanitix also charges nonprofits that qualify. Ticketebo is cheaper above about $8 a ticket, Ticket Tailor above about $24, and Eventfinda at most prices.
- Matching TryBooking would stay above Stripe's cost (break-even about $0.55 on a $12 ticket, assuming 10% international cards and 3% refunds), but the platform would keep about $0.24 of each $12 ticket instead of $0.77, needing about three times the volume for the same contribution. The candidate keeps its fee and competes with the low-cost plans on fit: member and non-member prices, presale caps, union rules and a final listed price.
- Humanitix (by default) and TryBooking keep their own fee when a ticket is refunded; Thunderstrux returns it (PAY-008).
- Music and stadium ticketers (Oztix, Moshtix, Ticketek, Ticketmaster) publish no organiser price; their fees fall on buyers.
- Unconfirmed: whether a university society qualifies for Humanitix's nonprofit rate, Ticket Tailor's AUD fee and GST, and Eventfinda's GST basis. H06 tests whether societies find the fee fair.

## Support and response

- **Purchases:** each society answers for its own; its contact email and refund policy appear on every event and shop page.
- **Thunderstrux contact:** none chosen, so `PLATFORM_SUPPORT_EMAIL` is unset; the founder decides address and owner before the pilot.
- **Alerts:** the deployment's engineering on-call owns every alert; refund and dispute alerts also go to whoever handles society support ([[Production Operations Alerts]]).

## Rollback

- **Images:** redeploy the previous release pair with a reviewed compatibility declaration. Migrations are additive; an older release ignores newer columns.
- **Fee:** orders made by a rolled-back release use its fee policy; every order records its own version.
- **Disputes:** rows recorded by the newer release stay in `PurchaseDispute`.
- **Workers:** pause before a restore; restored copies come up paused ([[Production Operations#Failure and recovery]]).

## Exclusions

- **The assistant (T35–T37):** deferred by the founder.
- **Product limits:** Australian dollars only, fixed-term memberships, pickup only, whole-order refunds only (no partial or buyer self-service refunds), and the other exclusions in section 11 of `docs/MVP_DELIVERY_PLAN_T10_T46.md`.
- **Not claimed:** live payouts, hosted operation, inbox delivery, certified accessibility. Screen-reader and real-zoom passes come before the pilot ([[Accessibility Review]]).
- **Legal:** no Terms of Service; the Privacy page is a plain-language summary, not a reviewed policy (LEGAL-001).

## Gates before real users and real money

State lives in [[Issue and Defect Register]]; H01–H06 are defined in `docs/MVP_READINESS_PLAN.md`.

| Gate | Needs |
| --- | --- |
| H01 qualified artifact deployment (OPS-004) | hosting bought; [[Production Operations Hosting]] H01 checklist done |
| H02 staff authority, private pilot, edge (SEC-001, SEC-002, SEC-019) | owners enrolled in MFA; edge rate limits |
| H03 hosted provider endpoints and delivery (PAY-002) | live webhook endpoints passing; verified sending domain |
| H04 schedules, monitoring and response (OPS-001, OPS-002) | schedules running; alert receiver and uptime check on the monitor itself |
| H05 hosted encrypted recovery (OPS-003) | off-machine encrypted backups and a hosted restore drill |
| H06 real-user testing and release decision | pilot societies |
| OPS-005 storage | Spaces test values set and the staging storage smoke passing |
| LEGAL-001 | terms and a reviewed privacy policy |
| Support address and owner | founder decision |
| Live money | founder approval after the critical gates pass |

## Go-live checklist for thunderstrux.com

Each item is configuration or an owner check; the code holds no hostname. Tick each against its register row before the first real user.

| Item | What to set or check | Row |
| --- | --- | --- |
| Domain | `SITE_ADDRESS=thunderstrux.com` and `ACME_EMAIL` for Caddy; `AUTH_URL`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, `TRUSTED_APP_ORIGINS` all `https://thunderstrux.com`. Production sends HSTS (`next.config.ts`). | H01 |
| Staff authority | `MFA_ENFORCEMENT_MODE=enforce`, `LEGACY_ORGANISATION_ACCESS_MODE=deny`; every owner enrols TOTP. Never run `prisma/seed.mjs` against production: it refuses a public origin unless `SEED_DEMO_PASSWORD` is set, which production never sets. | SEC-001 |
| Stripe | restricted `rk_live_` key; the two live webhook endpoints on the pinned version with their signing secrets ([[Production Operations#Stripe webhook endpoints and keys]]). | PAY-002 |
| Alerts | `ALERT_WEBHOOK_URL` at the chosen receiver; check its quota and grouping by `dedupeKey`. Unsigned-webhook alerts are cooled to one per 5 minutes per process, so a flood can't crowd out payment alerts (SEC-020). | OPS-002 |
| Edge rate limits | Caddy has none. Put Cloudflare (or another proxy) in front with limits on `/api/auth/*`, `/api/payments/webhook`, `/api/stripe/connect/webhook` and `/api/public/assets/*`. Then Caddy's `{remote_host}` is the proxy: set `trusted_proxies` to its ranges and take the client address from its header; confirm how IPv6 clients are keyed. | SEC-019, SEC-002 |
| Release | deploy only the `release-<revision>` manifest from the Release Images run of a `main` commit, selected by run id, after `gh attestation verify` with `--signer-workflow` and `--source-ref refs/heads/main`; `scripts/droplet.mjs` refuses images from other repositories. In GitHub, require approval for fork PR workflows and limit who can push branches or dispatch workflows (SEC-022). | H01 |
| Recovery | a restore fences identity automatically (sessions end; MFA logins, links and invitations revoked, SEC-023). In a real recovery rotate `AUTH_SECRET` and re-apply closures, password and email changes and staff revocations made after the restore point. | OPS-003 |
| Storage | Spaces bucket and keys, staging storage smoke passing. | OPS-005 |

## Related

[[Production Operations]] · [[Production Operations Hosting]] · [[Journey Qualification]] · [[E2E and Staging Payments]] · [[Issue and Defect Register]] · [[Project Handover]] · [[Accessibility Review]]
