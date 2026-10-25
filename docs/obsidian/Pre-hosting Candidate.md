---
status: living
last-reviewed: 2026-10-25
owner: engineering
related: ["[[Project Handover]]", "[[Journey Qualification]]", "[[E2E and Staging Payments]]", "[[Production Operations]]", "[[Non-Blocking Issue Register]]"]
sources: [docs/MVP_READINESS_PLAN.md, lib/stripe/fees.ts, docker-compose.hosted.yml, docker-compose.schedules.yml]
---

# Pre-hosting Candidate

T46's record of what would go to hosting, what proves it works locally, and what remains before real users or real money. It is a candidate, not a release: nothing here claims hosted operation, live payouts or certified accessibility.

## The candidate

- **Code:** `main` after the T46 merge. CI publishes its web and ops image pair, and the `release-<revision>` artifact from the Release Images run on that merge is what a deploy uses (see [[Production Operations]]).
- **Schema:** 64 migrations since the Stripe audit (62 at T46); the required one is `20261115010000_society_payouts` (PAY-005). All are additive. Migrations run as a one-shot job from the ops image before the web image rolls out.
- **Migration digest:** `8291fbe5b1ac5ae4f6d244cabcf129d6241f4641c4591e0f4c52e85f6e3d4929` (the endive staging campaign below); T46's runs had `64da2e06fe107086935feb7fa2e0826733594682b368c7c8d621515a8bc4a411`.

## Settings

| Setting | Candidate value | Why |
| --- | --- | --- |
| `MFA_ENFORCEMENT_MODE` | `enforce` | Staff money and authority actions need a fresh authenticator code (SEC-001 enrolment is H02). |
| `LEGACY_ORGANISATION_ACCESS_MODE` | `deny` | Only live staff rows grant authority. |
| `RATE_LIMIT_ENABLED` | `true`, with Redis and the trusted proxy header | Sign-in, checkout and staff actions are rate limited. |
| `ALERT_WEBHOOK_URL` (secret file) | required | The monitor and payment paths alert through it (OPS-002). |
| `EMAIL_FROM`, Resend key | required | Receipts and notices; inbox delivery needs a verified domain (H03). |
| `PLATFORM_SUPPORT_EMAIL` | optional, unset | Help and Privacy name it once the founder chooses an address and an owner. |
| Ticket compensation mode | `automatic_full` for new events (2026-10-25); a society may choose review | An unfillable ticket payment is refunded in full by the refund worker, as commerce is. No real sales until the hosted refund webhooks pass PAY-002. |
| Commerce compensation | automatic full refund | A membership or merchandise payment that can't be filled is refunded by the refund worker (PAY-003). |
| Fee policy | `platform_fee_3_75_percent_89c_v2` | 3.75% + $0.89 per ticket, membership or merchandise order; past orders keep theirs. |
| Stripe API version | `2026-09-30.endive`, stripe 23 (PAY-006) | Hosted webhook endpoints are created on it; the key should be a restricted `rk_live_` key ([[Production Operations]]). |
| Society payouts | manual, sent after each event (PAY-005), at most one payout a day (DEF-034) | Tickets 2 days after the event ends, memberships and merchandise 7 days after the sale, never held past 80 days. |
| Lost disputes | taken back from the society (PAY-004) | The transfer is reversed by the disputed amount; Thunderstrux keeps its fee and pays Stripe's dispute fee. |

## Jobs

Six bounded jobs run every minute under the T42 worker contract (leases, pause, timeouts, alerts): email outbox, notifications, stale orders and commerce expiry, refunds and compensation, checkout recovery, and the operations monitor. Use `docker-compose.schedules.yml` or the platform's scheduler. Since the Stripe audit the refunds job also takes back lost disputes (PAY-004) and sends society payouts, checking each society at most hourly and paying it at most once a day (PAY-005, DEF-034).

## Evidence

| What | Runs |
| --- | --- |
| Combined local qualification (T44d) | baseline `baseline-b2ff8cf634def9f550fa6665`, browser `browser-7d05b953af18e5356cfdd5dc`, operations `ops-17701f7891`, Droplet `droplet-707dfb0351` on `3ccada0` |
| Provider acceptance (T45) | Stripe test mode, nine scenarios (`staging-741aec2c…`, `staging-20ffc6bc…`, `staging-02b236b7…`); Resend accepted ticket receipts; storage blocked (OPS-005) |
| Commerce recovery (PAY-003) | baseline `baseline-9734427260591184e71e8334`, browser `browser-f884013075b6ac47e03097d7`, operations `ops-b747a83484`, staging `staging-a828d3d0…`, `staging-f5d4c10a…`, `staging-d1981708…` |
| T46 (fee, public pages, audit) | baseline `baseline-c0ff0efd8c4250c005ff024e` on `3e4bb68` (41/41 guards, 642 integration tests in 98 files, typecheck, clean audit); browser `browser-598296fd5c1112147bf994eb` on `78cc794` (9 MFA, 68 desktop/mobile with the Fees, Help and Privacy screenshots, 10 webhook checks). The commits after `3e4bb68` change only the public pages' layout and copy and their browser test. Staging `staging-531f5b0f778b85d1fe58fbf2` on `3e6f323` confirmed the new fee on real Stripe test mode: a $12.00 ticket carried a $1.34 application fee, and the full refund returned the $12.00 and the $1.34. |
| Stripe audit (DEF-031, PAY-004 to PAY-006) | #159 baseline `baseline-1f95f18e…` and browser `browser-7422320a…`; #160 baseline `baseline-986612515c5fbf9bf704355a`, operations `ops-cb89090db0`, staging `staging-d456141b…` (dispute reversed); #162 baseline `baseline-5a9e0e1f365e986ce8e74d58`, browser `browser-9f3bc87f…`, operations `ops-b68382c0ce`, a real $10.00 test-mode payout (`po_1UU4ZwRwWHtrRpnvSnTTzE4m`); #164 baseline `baseline-638068d83b1f4138dc931894`, browser `browser-1473fd78…`, full staging campaign `staging-872334655caa4b455d206a0f` on endive (twelve scenarios) |

[[Journey Qualification]] maps every section 7 journey to its tests. The readiness plan's section 8 carries T46's verdict for every PRD row.

## Fee review

Stripe charges its processing fee to the platform on destination charges, as observed in T45. A $9.00 test-card payment cost $0.62, which is 3.5% + 30c on an international card. Stripe keeps that fee when a payment is refunded. The flat 10% therefore lost money on small orders and on every refund.

The founder asked for a fee just under Humanitix. Humanitix's Australian Standard plan is 4% + $0.99 per ticket plus GST; its Charities & Schools plan is 2.5% + $0.50. Most student societies fall under Standard. The candidate's fee is 3.75% + $0.89 per ticket, membership or merchandise order. It includes GST where it applies, and the society absorbs it.

| Sample | Society receives (10%) | Society receives (new) | Humanitix fee if absorbed | Platform keeps after Stripe (domestic card) | (international card) |
| --- | --- | --- | --- | --- | --- |
| One $2 ticket | $1.80 | $1.03 | $1.18 | $0.64 (was −$0.13) | $0.60 |
| One $5 ticket | $4.50 | $3.92 | $1.31 | $0.69 | $0.60 |
| One $12 ticket | $10.80 | $10.66 | $1.62 | $0.84 | $0.62 |
| Two $12 tickets | $21.60 | $21.32 | $3.24 | $1.97 | $1.54 |
| $25 membership | $22.50 | $23.17 | $2.19 | $1.10 | $0.65 |
| $55 merchandise order | $49.50 | $52.05 | $3.51 | $1.71 | $0.72 |

How the table was worked:
- **Domestic card cost:** Stripe's published Australian price, 1.7% + 30c. It was not observed here.
- **International card cost:** 3.5% + 30c, as observed in T45.
- **Humanitix:** 4.4% + $1.09 per ticket with GST added. Humanitix doesn't sell merchandise, so its row is for comparison only.
- **Refunds:** a full refund returns the fee to the society. The platform loses Stripe's cost, about 50c on a $12 ticket.
- **Market price:** competitive pricing is not asserted beyond these published plans. H06 tests whether societies find the fee fair.

## Support and response

- **Purchases:** each society answers for its own. Its contact email and refund policy appear on every event and shop page.
- **Thunderstrux contact:** no address or owner is chosen yet, so `PLATFORM_SUPPORT_EMAIL` is unset. The founder decides both before the pilot.
- **Alerts:** the engineering on-call for the deployment owns every alert. Refund and dispute alerts also go to whoever handles society support ([[Production Operations]]).

## Rollback

- **Images:** redeploy the previous release pair. Every migration is additive, and an older release ignores the newer columns.
- **Fee change:** orders created by a rolled-back release use its fee policy, and every order records its own policy version.
- **Commerce disputes:** disputes recorded by the newer release stay in `PurchaseDispute`.
- **Workers:** pause them before a restore (`pnpm ops:workers -- pause all --reason=...`). Restored copies come up paused.

## What the candidate does not include

- **The assistant (T35–T37):** deferred by the founder on 2026-10-19.
- **Product limits:** Australian dollars only, fixed-term memberships, pickup only, and whole-order refunds only. Partial and buyer self-service refunds are out, as are the other items in delivery plan section 11.
- **Not claimed:** live payouts, hosted operation, inbox delivery, and certified accessibility. Screen-reader and real-zoom passes come before the pilot.
- **Legal:** there are no Terms of Service, and the Privacy page is a plain-language summary rather than a reviewed policy (LEGAL-001).

## Gates before real users and real money

| Gate | State |
| --- | --- |
| H01 qualified artifact deployment | Not started: hosting not bought |
| H02 staff authority, private pilot, edge | Not started |
| H03 hosted provider endpoints and delivery (PAY-002) | Not started |
| H04 schedules, monitoring and response (OPS-001, OPS-002) | Not started |
| H05 hosted encrypted recovery (OPS-003) | Not started |
| H06 real-user testing and release decision | Not started |
| OPS-005 storage provider evidence | Blocked on Spaces values |
| LEGAL-001 terms and reviewed privacy policy | Founder |
| Support address and owner | Founder |
| Live money | Founder approval after the critical gates pass |

## Go-live checklist for thunderstrux.com

Settings and checks that move the candidate from a preview host to `https://thunderstrux.com` on the Droplet path. The code holds no hostname, so each is configuration or an owner check. Tick each against its register row before the first real user (T52).

| Item | What to set or check | Row |
| --- | --- | --- |
| Domain | `SITE_ADDRESS=thunderstrux.com` and `ACME_EMAIL` for Caddy; `AUTH_URL`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL` and `TRUSTED_APP_ORIGINS` all `https://thunderstrux.com`. Production sends HSTS (`next.config.ts`). | H01 |
| Staff authority | `MFA_ENFORCEMENT_MODE=enforce`, `LEGACY_ORGANISATION_ACCESS_MODE=deny`; every owner enrols TOTP. Never run `prisma/seed.mjs` against production; it refuses a public origin unless `SEED_DEMO_PASSWORD` is set, which production never sets. | SEC-001, SEC-015 |
| Stripe | A restricted `rk_live_` key and the two live webhook endpoints on `2026-09-30.endive`, with their signing secrets ([[Production Operations]]). | PAY-002, PAY-006 |
| Alerts | `ALERT_WEBHOOK_URL` points at the chosen receiver; check its quota and grouping. Unsigned-webhook alerts are cooled to one per five minutes per process, so a flood can't page or crowd out payment alerts. | OPS-002, SEC-020 |
| Edge rate limits | Caddy has none. Put Cloudflare (or another proxy) in front with limits on `/api/auth/*`, `/api/payments/webhook`, `/api/stripe/connect/webhook` and `/api/public/assets/*`. With a proxy in front, Caddy's `{remote_host}` is the proxy, so set `trusted_proxies` to its ranges and take the client address from its header; confirm how IPv6 clients are keyed. | SEC-019, SEC-021, SEC-002 (gate) |
| Release | Deploy only the `release-<revision>` manifest from the Release Images run of a `main` commit, by run id, after verifying both images with `--signer-workflow` and `--source-ref refs/heads/main`; `scripts/droplet.mjs` refuses images from any other repository. In GitHub, require approval for fork pull-request workflows and limit who can push branches or dispatch workflows. | SEC-022 |
| Recovery | A restore fences identity automatically (every session ends; MFA logins, links and invitations are revoked). During a real recovery, rotate `AUTH_SECRET` and re-apply closures, password and email changes and staff revocations made after the restore point (Recovery runbook). | SEC-023, OPS-003 |
| Storage | Spaces bucket and keys, with the T45 smoke passing. | OPS-005 |
