---
status: living
last-reviewed: 2026-11-03
owner: engineering
related: ["[[Authentication and Dashboard Access]]", "[[Audit Coverage]]", "[[Production Operations]]", "[[Route Security Inventory]]", "[[Database and Multi Tenancy]]"]
sources: [lib/platform/authority.ts, lib/platform/operators.ts, lib/platform/mode.ts, lib/platform/audit.ts, lib/platform/search.ts, lib/platform/records.ts, lib/platform/overview.ts, lib/permissions/platform.ts, proxy.ts, scripts/operators.ts, scripts/operations.mjs, components/admin/admin-shell.tsx]
---

# Platform Admin Portal

**Owns:** the platform admin portal at `/admin` (T54): who an operator is, how they reach it, what it shows, the platform trail, the operator CLI and the loopback runner.
**Read when:** changing anything under `app/(admin)`, `lib/platform/` or `components/admin/`, granting an operator, or running the portal against the preview or production.
**Not here:** society staff roles and staff MFA ([[Authentication and Dashboard Access]]); what each society action records ([[Audit Coverage]]); deploys, workers and recovery ([[Production Operations]]).

The portal is for Thunderstrux's own developers and operators, never societies or buyers. T54 is read-only; the changes (disable an account, recovery, restriction, payout hold, worker controls) arrive with T55. Design: round H on the design canvas, approved 3 Nov 2026.

## Code

| Concern | Where |
| --- | --- |
| Portal switch and host check | `lib/platform/mode.ts`: `isAdminPortalEnabled`, `adminHostAllowed`, `ADMIN_WINDOW_MS` |
| Proxy 404 outside admin mode | `proxy.ts` |
| Live operator rule, CLI grant and revoke | `lib/platform/operators.ts`: `livePlatformRole`, `grantPlatformOperator`, `revokePlatformOperator`, `listPlatformOperators` |
| Page guard | `lib/platform/authority.ts`: `requirePlatformOperator`, `requirePlatformPage`, `landsInAdmin` |
| Roles and permissions | `lib/permissions/platform.ts`: `platformPermissions`, `hasPlatformPermission` |
| Trail | `lib/platform/audit.ts`: `recordPlatformView`, `recordPlatformSearch`, `searchDigest`, `readPlatformAudit`; pruning in `lib/security/token-cleanup.ts` |
| Omnibox search | `lib/platform/search.ts`: `searchPlatform` |
| Records and overview | `lib/platform/records.ts` (`readUserRecord`, `readSocietyRecord`, `readOrderRecord`, `listNewestUsers`, `listSocieties`), `lib/platform/overview.ts` (`readNeeds`, `readHealth`, `readCounts`) |
| Shell and parts | `components/admin/admin-shell.tsx`, `components/admin/omnibox.tsx`, `components/admin/verify-window.tsx`, `components/admin/record.tsx`, `components/admin/id-chip.tsx`, `components/admin/admin-sign-out.tsx` |
| CLI | `scripts/operators.mjs` → `scripts/operators.ts` (`pnpm ops:operator`) |
| Loopback runner | `scripts/operations.mjs` `admin` (`pnpm ops:admin`), `adminPortalRunArgs` in `scripts/operations-guards.mjs` |
| Tests | `tests/integration/platform-admin.test.ts`, `tests/runner/operations.test.mjs`, `tests/runner/container-config.test.mjs` |

## Who can reach it

Every check below must pass, in this order, on every page:
1. **The process serves it.** Only a process with `ADMIN_PORTAL_ENABLED=true` serves `/admin`: the dev app and the `pnpm ops:admin` container. The public app never sets it, and `validateHostedConfig` refuses it on the hosted `app` service, so `/admin` answers 404 on any public host. In admin mode `proxy.ts` also answers 404 to a `Host` that isn't the sign-in URL's (`AUTH_URL`, else `NEXTAUTH_URL`; `localhost` and `127.0.0.1` count as the same machine), which stops a rebinding page from reaching the loopback port.
2. **A signed-in, live account** (`requireAuthenticatedUser`), else `/login`.
3. **An active `PlatformOperator` row** on an account that isn't disabled (`livePlatformRole`), else the same 404 a missing page gives.
4. **Staff MFA settings present** (`MFA_ENCRYPTION_KEY`, `RATE_LIMIT_ENABLED=true`), else the page errors.
5. **An authenticator, verified in the last 60 minutes** on this login (`MfaGrant.verifiedAt`), else `/mfa?callbackUrl=`. This never reads `MFA_ENFORCEMENT_MODE`: the preview runs `off` for society staff, and the portal still asks.
6. **The page's permission**, else 404.
7. **The read limit** `platform_read` (600 pages an hour per operator, fail open so an incident can still be investigated without Redis).

| Permission | `support` | `admin` |
| --- | --- | --- |
| `platform:monitor` (overview, operations) | ✓ | ✓ |
| `platform:read` (search, users, societies, orders) | ✓ | ✓ |
| `platform:audit_read` (the trail) | | ✓ |
| `platform:operators` (the operator list) | | ✓ |

While a page is open, the shell counts the window down; under 10 minutes it offers Extend (`/mfa`), and at zero a code dialog covers the page (`POST /api/me/mfa/verify`) and a verified code reloads it in place.

## Operators

- **Dedicated accounts.** `grantPlatformOperator` refuses an account that is unverified, disabled, closed, a society login (`accountRole` `organisation`), staff of any society or on a legacy owner pointer. An active operator can't accept a staff invitation (`acceptOrganisationStaffInvite` answers the generic refusal), and can't create a society, because only society logins can.
- **Granted only from the host.** `pnpm ops:operator -- grant <email> --role=support|admin --note="why"`, `revoke <email> --reason="why"`, `list`. The CLI writes `platform.operator_granted`, `platform.operator_role_changed` or `platform.operator_revoked` with no web actor (`metadata.via` `cli`, `by` the OS user and host) and alerts `platform_operator_changed`. The web portal never grants.
- **Authenticator.** Operators use the staff authenticator flows (`/mfa`): `requireStaffEligibility` accepts an active operator. Their steps go to the platform trail as `platform.mfa_enabled`, `platform.mfa_verified`, `platform.mfa_recovery_used` and `platform.mfa_recovery_codes_replaced`, never to a society, and each verification alerts `platform_operator_verified`.
- **Landing.** In an admin process, an operator who opens `/dashboard` goes to `/admin` (`landsInAdmin`).

## Running it

- **Dev:** `http://127.0.0.1:3080/admin` (the dev app sets `ADMIN_PORTAL_ENABLED` in `docker-compose.dev.yml`, and it trusts `127.0.0.1:3080`, not `localhost`, for writes such as authenticator set-up).
- **Preview or production:** `pnpm ops:admin -- --project <ops-…> --env-file <file>` runs this project's current release image (`current-release.json`) as a one-off `app` container beside its database and Redis, published on `127.0.0.1:3091` only, with `ADMIN_PORTAL_ENABLED=true`, `AUTH_URL`, `NEXTAUTH_URL` and `TRUSTED_APP_ORIGINS` set to `http://localhost:3091`. `NEXT_PUBLIC_APP_URL` stays the public site, so any email links there. It refuses a busy port, waits for readiness, prints the URL, and Ctrl-C stops and removes it. From another machine: `ssh -L 3091:127.0.0.1:3091 <host>` first. Never tunnel port 3091.
- The admin session cookie belongs to the loopback origin, so nothing on the public site can use it.

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
| `/admin/operators` | Operators and their authenticator state |

The omnibox (`/` or Ctrl/⌘+K) takes an email (exact), an app id, `cs_` or `pi_` (the order paid with it), `acct_` or `po_` (the society), `re_`, `du_` or `dp_` (the order), a six-character order reference, or a name. Recent records it lists live in the tab's `sessionStorage` only, with display names, never emails.

## The trail

- `PlatformAuditLog` rows are written by the CLI and the portal, never by society code. Each detail page writes `platform.viewed`; each search writes `platform.searched` with `searchDigest` of the normalised query and the result count, never the text, so a buyer's email is never stored.
- The trigger `PlatformAuditLog_append_only` refuses every update (except the foreign key clearing a deleted society) and every delete except a view or search row over two years old, which `cleanUpExpiredTokens` deletes, 500 a run. The database owner can still drop the trigger, so the alert webhook is the copy outside the database (OPS-002).
- `adminPathFor` adds `adminPath` (`/admin/orders/…`, `/admin/societies/…` or `/admin/users/…`) to an alert that names a record, so the receiver links straight to it while the portal runs.

## Traps

- A page guard is `requirePlatformPage(permission, path)`, never `requireManagementPage`: staff authority grants nothing here, and operator authority grants nothing in a society.
- Don't add `ADMIN_PORTAL_ENABLED` to the base `docker-compose.yml` app service: that is the public app.
- A query a record page shows must use an allow-listed `select`. Never a password hash, authenticator secret, recovery code, token digest, encrypted payload or raw provider payload.
- A new `platform.*` action must be named in [[Audit Coverage]]; `history.test.ts` leaves `platform.` actions out of society History on purpose.
- The fast integration reset truncates `PlatformAuditLog` (`tests/helpers/db-reset.ts`), because the trigger refuses row deletes.

## Failure and recovery

| Symptom | Cause | Fix |
| --- | --- | --- |
| `/admin` is a 404 for an operator | The process isn't in admin mode, the host isn't the sign-in host, the operator row is revoked, or the account is disabled | Use the dev app at `127.0.0.1:3080` or `pnpm ops:admin`; check `pnpm ops:operator -- list` |
| Always sent to `/mfa` | No authenticator, or none verified in the last 60 minutes | Verify; a lost authenticator is reset by T55's recovery, until then by hand on the host |
| `pnpm ops:admin` says the port is in use | Another admin portal is running | Stop it (Ctrl-C in its terminal) |
| After a restore | `fence-restored-identity.sql` empties grants, so every operator verifies again; operator rows come back as they were at the backup | Re-apply operator revocations made after the restore point, read from the `platform_operator_changed` alerts ([[Production Operations#Failure and recovery]]) |

## Related

[[Authentication and Dashboard Access]] · [[Audit Coverage]] · [[Route Security Inventory]] · [[Database and Multi Tenancy]] · [[Production Operations]] · [[Production Operations Alerts]] · [[Environment Variables]]
