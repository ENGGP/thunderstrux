---
status: living
last-reviewed: 2026-11-03
owner: engineering
related: ["[[Authentication and Dashboard Access]]", "[[Audit Coverage]]", "[[Production Operations]]", "[[Route Security Inventory]]", "[[Database and Multi Tenancy]]"]
sources: [lib/platform/authority.ts, lib/platform/operators.ts, lib/platform/mode.ts, lib/platform/audit.ts, lib/platform/search.ts, lib/platform/records.ts, lib/platform/overview.ts, lib/platform/changes.ts, lib/platform/accounts.ts, lib/platform/societies.ts, lib/platform/recovery.ts, lib/platform/operations.ts, lib/platform/specs.ts, lib/permissions/platform.ts, proxy.ts, app/api/admin/actions/route.ts, scripts/operators.ts, scripts/operations.mjs, components/admin/admin-shell.tsx, components/admin/action-dialog.tsx, components/admin/recovery-wizard.tsx]
---

# Platform Admin Portal

**Owns:** the platform admin portal at `/admin` (T54, T55): who an operator is, how they reach it, what it shows, every change an operator can make, the platform trail, the operator CLI and the loopback runner.
**Read when:** changing anything under `app/(admin)`, `lib/platform/` or `components/admin/`, granting an operator, or running the portal against the preview or production.
**Not here:** society staff roles and staff MFA ([[Authentication and Dashboard Access]]); what each society action records ([[Audit Coverage]]); deploys, workers and recovery ([[Production Operations]]).

The portal is for Thunderstrux's own developers and operators, never societies or buyers. T54 built the read-only portal; T55 added the changes (account help and disable, delayed recovery, restriction, payout hold, operator revoke, worker controls). No impersonation, no refunds or cancellations, no money movement and no export. Design: round H on the design canvas, approved 3 Nov 2026.

## Code

| Concern | Where |
| --- | --- |
| Portal switch and host check | `lib/platform/mode.ts`: `isAdminPortalEnabled`, `adminHostAllowed`, `ADMIN_WINDOW_MS` |
| Proxy 404 outside admin mode | `proxy.ts` |
| Live operator rule, CLI grant and revoke | `lib/platform/operators.ts`: `livePlatformRole`, `grantPlatformOperator`, `revokePlatformOperator`, `listPlatformOperators` |
| Page guard | `lib/platform/authority.ts`: `requirePlatformOperator`, `requirePlatformPage`, `landsInAdmin` |
| Roles and permissions | `lib/permissions/platform.ts`: `platformPermissions`, `hasPlatformPermission` |
| Trail | `lib/platform/audit.ts`: `recordPlatformView`, `recordPlatformSearch`, `searchDigest`, `readPlatformAudit`; pruning in `lib/security/token-cleanup.ts` |
| Omnibox search | `lib/platform/search.ts`: `searchPlatform`; the server action `adminSearch` (`app/(admin)/admin/search/actions.ts`) |
| Records and overview | `lib/platform/records.ts` (`readUserRecord`, `readSocietyRecord`, `readOrderRecord`, `listNewestUsers`, `listSocieties`), `lib/platform/overview.ts` (`readNeeds`, `readHealth`, `readCounts`) |
| Shell and parts | `components/admin/admin-shell.tsx`, `components/admin/omnibox.tsx`, `components/admin/verify-window.tsx`, `components/admin/record.tsx`, `components/admin/id-chip.tsx`, `components/admin/admin-sign-out.tsx` |
| Changes | `POST /api/admin/actions` (`app/api/admin/actions/route.ts`); `lib/platform/changes.ts` (`platformWrite`, `notifyPeople`, `societyHistory`), `lib/platform/accounts.ts` (`changeAccount`), `lib/platform/societies.ts` (`changeSociety`), `lib/platform/recovery.ts` (`requestRecovery`, `completeRecovery`, `cancelRecovery`, `readRecoveryRequest`), `lib/platform/operations.ts` (`setWorkerPaused`, `runIntegrityAudit`, `revokeOperatorFromWeb`); `lockPlatformActor` and `platformApiActor` in `authority.ts` |
| Dialogs | `components/admin/action-dialog.tsx` (`ActionDialog`, `AdminActions`), `components/admin/recovery-wizard.tsx` with the server action `lookupRecoveryCandidate` (`app/(admin)/admin/recovery/actions.ts`); each dialog's words come from `lib/platform/specs.ts` |
| CLI | `scripts/operators.mjs` → `scripts/operators.ts` (`pnpm ops:operator`) |
| Loopback runner | `scripts/operations.mjs` `admin` (`pnpm ops:admin`), `adminPortalRunArgs` in `scripts/operations-guards.mjs` |
| Tests | `tests/integration/platform-admin.test.ts`, `tests/integration/platform-controls.test.ts`, `tests/runner/operations.test.mjs`, `tests/runner/container-config.test.mjs` |

## Who can reach it

Every check below must pass, in this order, on every page:
1. **The process serves it.** Only a process with `ADMIN_PORTAL_ENABLED=true` serves `/admin`: the dev app and the `pnpm ops:admin` container. The public app never sets it, and `validateHostedConfig` refuses it on the hosted `app` service, so `/admin` answers 404 on any public host. In admin mode `proxy.ts` also answers 404 to a `Host` that isn't the sign-in URL's (`AUTH_URL`, else `NEXTAUTH_URL`; `localhost` and `127.0.0.1` count as the same machine; a `Host` with userinfo, a path, a query or a fragment is refused outright), which stops a rebinding page from reaching the loopback port. Server actions post to their `/admin` page, so the same check covers them.
2. **A signed-in, live account** (`requireAuthenticatedUser`), else `/login`.
3. **An active `PlatformOperator` row** on an account that isn't disabled (`livePlatformRole`), else the same 404 a missing page gives.
4. **Staff MFA settings present** (`MFA_ENCRYPTION_KEY`, `RATE_LIMIT_ENABLED=true`), else the page errors.
5. **An authenticator, verified in the last 60 minutes** on this login (`MfaGrant.verifiedAt`), else `/mfa?callbackUrl=`. This never reads `MFA_ENFORCEMENT_MODE`: the preview runs `off` for society staff, and the portal still asks. The one exception is the dev app: `docker-compose.dev.yml` sets `ADMIN_PORTAL_MFA=off`, and `adminMfaOff` (`lib/platform/mode.ts`) honours it only under `NODE_ENV=development`, so steps 4 and 5 and the change dialog's code are skipped there (the shell shows "No code (dev)"). Built images run `NODE_ENV=production`, so the preview and production always ask.
6. **The page's permission**, else 404.
7. **The read limit** `platform_read` (600 pages an hour per operator, fail open so an incident can still be investigated without Redis).

| Permission | `support` | `admin` |
| --- | --- | --- |
| `platform:monitor` (overview, operations) | ✓ | ✓ |
| `platform:read` (search, users, societies, orders, recovery requests) | ✓ | ✓ |
| `platform:account_assist` (resend verification, send a password reset, sign out everywhere) | ✓ | ✓ |
| `platform:account_disable` (disable, re-enable) | | ✓ |
| `platform:recovery` (request, complete or cancel an authenticator reset or ownership recovery) | | ✓ |
| `platform:society_control` (restrict and lift, hold and release payouts) | | ✓ |
| `platform:operations` (pause and resume jobs, run the integrity audit) | | ✓ |
| `platform:audit_read` (the trail) | | ✓ |
| `platform:operators` (the operator list, revoke another) | | ✓ |

While a page is open, the shell counts the window down; under 10 minutes it offers Extend (`/mfa`), and at zero a code dialog covers the page (`POST /api/me/mfa/verify`) and a verified code reloads it in place.

## Operators

- **Dedicated accounts.** `grantPlatformOperator` refuses an account that is unverified, disabled, closed, a society login (`accountRole` `organisation`), staff of any society or on a legacy owner pointer. An active operator can't accept a staff invitation (`acceptOrganisationStaffInvite` answers the generic refusal), and can't create a society, because only society logins can.
- **Granted only from the host.** `pnpm ops:operator -- grant <email> --role=support|admin --note="why"`, `revoke <email> --reason="why"`, `list`. The CLI writes `platform.operator_granted`, `platform.operator_role_changed` or `platform.operator_revoked` with no web actor (`metadata.via` `cli`, `by` the OS user and host) and alerts `platform_operator_changed`. The web portal never grants.
- **Authenticator.** Operators use the staff authenticator flows (`/mfa`): `requireStaffEligibility` accepts an active operator. Their steps go to the platform trail as `platform.mfa_enabled`, `platform.mfa_verified`, `platform.mfa_recovery_used` and `platform.mfa_recovery_codes_replaced`, never to a society, and each verification alerts `platform_operator_verified`.
- **Landing.** In an admin process, an operator who opens `/dashboard` goes to `/admin` (`landsInAdmin`).

## Running it

- **Dev:** `http://127.0.0.1:3080/admin` (the dev app sets `ADMIN_PORTAL_ENABLED` in `docker-compose.dev.yml`, and it trusts `127.0.0.1:3080`, not `localhost`, for writes such as authenticator set-up). The dev portal asks for no authenticator (`ADMIN_PORTAL_MFA=off`).
- **Preview or production:** `pnpm ops:admin -- --project <ops-…> --env-file <file>` runs this project's current release image (`current-release.json`) as a one-off `app` container beside its database and Redis, published on `127.0.0.1:3091` only, with `ADMIN_PORTAL_ENABLED=true`, `AUTH_URL`, `NEXTAUTH_URL` and `TRUSTED_APP_ORIGINS` set to `http://localhost:3091`. `NEXT_PUBLIC_APP_URL` stays the public site, so any email links there. It refuses a busy port, waits for readiness, prints the URL, and Ctrl-C stops and removes it. From another machine: `ssh -L 3091:127.0.0.1:3091 <host>` first. Never tunnel port 3091.
- **Granting on the preview:** run the CLI in the release's ops image against that project's database: `OPS_IMAGE=$(node -p "require('./tmp/operations/ops-preview/current-release.json').opsImageId") docker compose --env-file .env.preview -p ops-preview -f docker-compose.yml -f docker-compose.hardened.yml run --rm migration node scripts/operators.mjs grant <email> --role=admin --note="…"`. Without `OPS_IMAGE`, Compose builds a fresh `thunderstrux-ops:local` from the folder instead.
- The admin session cookie belongs to the loopback origin, so nothing on the public site can use it. The admin process trusts its own sign-in origin (`AUTH_URL`) for changes, never `NEXT_PUBLIC_APP_URL`, which it keeps only for links in notices (`configuredTrustedOrigins`).

## Pages

Every page is a server page in `app/(admin)/admin/` inside `AdminShell`, which replaces the site header (the navbar steps aside on `/admin`), and shows the environment band (DEV, PREVIEW or PRODUCTION from `appUrl()`, with the Stripe mode). Ids show whole with Copy; times show in Brisbane (or the society's zone) with the UTC time on hover, to match logs.

| Page | Shows |
| --- | --- |
| `/admin` | Needs you (disputes due within 72 h, compensation reviews, refunds of unknown outcome, failed payouts, queues past their alert limit, paused or stale jobs), worst first; health; counts for the last 24 hours and 7 days |
| `/admin/search` | The omnibox's results. One match opens its record; several are grouped; none says which environment this is |
| `/admin/users`, `/admin/users/[userId]` | Search, the 50 newest signups; one person's account, security (never secrets), staff roles, purchases, Activity, Raw |
| `/admin/societies`, `/admin/societies/[organisationId]` | Every society (200 at most); one society's staff, Stripe, events, payouts, its own History and support Activity |
| `/admin/orders`, `/admin/orders/[orderId]` | Find by reference or id; one ticket, membership or shop order with its lifecycle, refunds, disputes and tickets. No money buttons: refunds happen in Stripe or on the society's page |
| `/admin/operations` | Workers and queues, as `pnpm ops:workers -- status` reads them |
| `/admin/audit` | The platform trail, filtered by action and target |
| `/admin/operators` | Operators and their authenticator state; Revoke |
| `/admin/recovery/[requestId]` | One recovery request: requested, who was told and whether each notice went out, ready on, the outcome; Complete (from `executeAfter`, after a recheck) and Cancel |

The omnibox (`/` or Ctrl/⌘+K) posts to the server action `adminSearch`, so a pasted email never reaches a URL or the browser history: one match opens its record, none opens `/admin/search?none=1`, and only a name or id with several matches goes to `/admin/search?q=`. It takes an email (exact), an app id, `cs_` or `pi_` (the order paid with it), `acct_` or `po_` (the society), `re_`, `du_` or `dp_` (the order), a six-character order reference, or a name. Recent records it lists live in the tab's `sessionStorage` only, with display names, never emails.

## Changes

Every change goes through one dialog (board H7, `ActionDialog`): what will happen (and what won't), why (a reason picker plus details, 8 to 500 characters), then a fresh 6-digit authenticator code. The dialog title repeats the environment. The code renews the 60-minute window, so a change never bounces to `/mfa`. A refusal names its reason and keeps what was typed; an unexpected error names the operation (`admin.<action>`) and time for finding `api.request_failed`. The result sits under the button, with Undo where there is an opposite (re-enable, lift, release, resume), which opens that dialog with the reason filled in. The Actions menu lists only what the role allows, and shows an action that doesn't apply now disabled, with why.

`platformWrite` runs each one in a transaction: `lockPlatformActor` locks the operator's `User`, rechecks `authVersion`, the live role and the permission, and uses the code once (`consumeStaffMfaCode`); then the change locks its target, applies, enqueues its notices, writes any society History row and the `PlatformAuditLog` row with the reason. After commit it alerts `platform_admin_action`. A refusal (`PlatformRefusal`, 409) rolls all of it back, the code included.

| Change | Effect | Who hears |
| --- | --- | --- |
| Resend verification; send password reset | The usual verify or reset link (`issueVerification`, `issuePasswordReset`); refused for a disabled account, and verification for a verified one | the person, by the usual email |
| Sign out everywhere | `authVersion` + 1, every `MfaGrant` deleted; security event `support_signed_out` | `account_signed_out_by_support` |
| Disable; re-enable | `disabledAt` set with the sign-out (live staff authority stops at once), or cleared; security events `support_disabled`, `support_reenabled`. Tickets and orders stay | `account_disabled`, `account_reenabled`; History in each society they staff |
| Restrict; lift | `restrictedAt` and `restrictionReason`. While set: every checkout family refuses (free registration included), publishing an event, plan or product and reopening sales refuse, Stripe onboarding, the Connect dashboard link and disconnect refuse, payouts wait, and its events leave Explore, the home page and society pages ([[Event Lifecycle]]). Tickets, check-in, refunds, reads and fulfilment of a payment Stripe already took carry on | owners by `society_restricted`, `society_unrestricted`; History; the society Overview and Payments page say so |
| Hold payouts; release | `payoutsHeldAt`, optional `payoutsHeldUntil`, `payoutsHeldReason`. `processPayoutBatch` sends a held society nothing until the end date (or release), keeps its account on manual payouts, and checks the hold again just before a payout (PAY-071). The Connect dashboard link and disconnect refuse while it lasts (PAY-070). Stripe still pays out manual-payout money after 90 days (PAY-022) | History; the Payments page notice |
| Authenticator reset (delayed) | Request: the person must have an authenticator. Complete, from 72 hours later: deletes `UserMfa`, recovery codes and grants, `authVersion` + 1 | the person and the owners and admins of every society they're staff of: `mfa_reset_requested`, `mfa_reset_completed` |
| Ownership recovery (delayed) | Request names an existing, verified, enabled account that isn't an operator or already an owner; the trail keeps the current owners' last sign-in. Complete: that account's staff row becomes `owner` (nobody else's changes) and payouts are held for 7 days (an open-ended hold stays open-ended) | every active staff member, the society's contact address and the new owner: `ownership_recovery_requested`, `ownership_recovered`; History |
| Cancel a request | `status` `cancelled` | everyone it told: `recovery_cancelled`; History for an ownership request |
| Revoke an operator | `status` `revoked`, `revokedByUserId`. Never yourself; the revoked one's authority is read live under lock, so two admins can't revoke each other to none | `platform_operator_changed` (`via: "web"`) |
| Pause, resume a job; run the integrity audit | The same `WorkerLease` write as `pnpm ops:workers`; `runDatabaseIntegrityAudit`, whose counts and sample ids the Operations page shows from the trail | ops |

**Delayed recovery** (board H8). The wizard is three steps: who (an authenticator reset is the record you're on; an ownership recovery finds an existing account by exact email, posted to `lookupRecoveryCandidate` and logged as a search), what you checked (a checklist and notes, the stored evidence), then who will be emailed and when it can be completed, with the reason and code. Completion rechecks under the locks (target and requester `User`s in sorted order, `Organisation`, the request): still verified and enabled, not an operator, and for a reset an authenticator still there, for ownership not an owner yet; the operator who asked still has `platform:recovery` on a live, enabled account (SEC-047); and every notice the request sent was accepted by the email provider, since the 72 hours protect only people who heard. The request page shows each as a check. Anything else refuses with one answer: cancel and start again. A restore can bring an old request back, so the recheck applies to it too. Ready requests rise to the top of Needs you; waiting ones and restricted or held societies are listed too.

Account changes never touch your own account or an operator's (`pnpm ops:operator` on the host does), and refuse a closed account. An operator's lost authenticator is reset on the host.

## The trail

- `PlatformAuditLog` rows are written by the CLI and the portal, never by society code. Each detail page writes `platform.viewed`; each search writes `platform.searched` once, with `searchDigest` (an HMAC of the normalised query keyed with `MFA_ENCRYPTION_KEY`) and the result count, never the text. With the key, someone on the host can check a candidate; a database or backup reader without it can't hash the User table to learn who was searched.
- The trigger `PlatformAuditLog_append_only` refuses every update (except the foreign key clearing a deleted society) and every delete except a view or search row over two years old, which `cleanUpExpiredTokens` deletes, 500 a run. The database owner can still drop the trigger, so the alert webhook is the copy outside the database (OPS-002).
- `adminPathFor` adds `adminPath` (`/admin/orders/…`, `/admin/societies/…` or `/admin/users/…`) to an alert that names a record, so the receiver links straight to it while the portal runs.

## Traps

- A page guard is `requirePlatformPage(permission, path)`, never `requireManagementPage`: staff authority grants nothing here, and operator authority grants nothing in a society.
- Don't add `ADMIN_PORTAL_ENABLED` to the base `docker-compose.yml` app service: that is the public app.
- A query a record page shows must use an allow-listed `select`. Never a password hash, authenticator secret, recovery code, token digest, encrypted payload or raw provider payload.
- A new `platform.*` action must be named in [[Audit Coverage]]; `history.test.ts` leaves `platform.` actions out of society History on purpose.
- `pnpm ops:admin` keeps a timer while it waits for Ctrl-C: a signal listener alone doesn't keep Node running, and the first real run (preview, 3 Nov 2026) ended at once with exit 13 and left `ops-preview-admin` up unsupervised. If a run ever ends early, `docker stop ops-preview-admin` removes the container.
- The fast integration reset truncates `PlatformAuditLog` (`tests/helpers/db-reset.ts`), because the trigger refuses row deletes.
- A change is a `platformWrite`, never a direct write: that is what puts the trail row, the permission recheck and the one-use code in the same transaction. Lock the target after `lockPlatformActor`, in the order User, Organisation, then the request or operator row.
- `payoutsAllowedWhere` lives in `lib/payouts/payouts.ts`, not `lib/platform/`: the refunds worker must not load the portal's HTTP and session modules.
- Society History rows from support have no actor; History names them by the `platform.` prefix. Never put the operator's reason in a society row or a notice.

## Failure and recovery

| Symptom | Cause | Fix |
| --- | --- | --- |
| `/admin` is a 404 for an operator | The process isn't in admin mode, the host isn't the sign-in host, the operator row is revoked, or the account is disabled | Use the dev app at `127.0.0.1:3080` or `pnpm ops:admin`; check `pnpm ops:operator -- list` |
| Always sent to `/mfa` | No authenticator, or none verified in the last 60 minutes | Verify; an operator's lost authenticator is reset by hand on the host (the portal's reset is for other accounts) |
| A change answers "That code was already used" | Each 30-second code works once, the window's included | Wait for the next code; the reason is kept |
| Rolling back to a build before T55 | An older payouts worker ignores `restrictedAt` and the payout hold | Pause the `refunds` job first ([[Production Operations#Backup, restore and rollback]]) |
| `pnpm ops:admin` says the port is in use | Another admin portal is running | Stop it (Ctrl-C in its terminal) |
| After a restore | `fence-restored-identity.sql` empties grants, so every operator verifies again, and cancels pending recovery requests and their queued notices, whose notices and objections after the restore point are gone; operator rows come back as they were at the backup | Re-apply operator revocations made after the restore point, read from the `platform_operator_changed` alerts ([[Production Operations#Failure and recovery]]) |

## Related

[[Authentication and Dashboard Access]] · [[Audit Coverage]] · [[Route Security Inventory]] · [[Database and Multi Tenancy]] · [[Production Operations]] · [[Production Operations Alerts]] · [[Environment Variables]]
