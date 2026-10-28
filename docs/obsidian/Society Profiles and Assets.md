---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Database and Multi Tenancy]]", "[[Event Lifecycle]]", "[[Memberships and Merchandise]]", "[[Route Security Inventory]]", "[[Production Operations]]"]
sources: [lib/assets/service.ts, lib/assets/storage.ts, lib/assets/image.ts, lib/assets/references.ts, lib/assets/maintenance.ts, lib/organisations/profile.ts, lib/organisations/join.ts, lib/organisations/discovery.ts, lib/organisations/bootstrap.ts, lib/organisations/authority.ts, scripts/maintain-assets.mjs, docker-compose.dev.yml]
---

# Society Profiles and Assets

**Owns:** society creation (bootstrap), the public profile and its editor, the society directory and free join/leave, and the image (asset) contract: upload, sanitisation, quotas, references, delivery, cleanup and storage.
**Read when:** changing a society's public fields, discovery or joining, or anything that stores or serves an image.
**Not here:** staff roles and invites ([[Authentication and Dashboard Access]]); paid memberships ([[Memberships and Merchandise]]); event images on events ([[Event Lifecycle#Hero image]]); guard order and rate-limit numbers ([[Route Security Inventory]]); storage env vars ([[Environment Variables]]); backups ([[Production Operations]]).

## Code

| Concern | Where |
| --- | --- |
| Upload, delete, preview, public and member delivery | `lib/assets/service.ts`: `uploadAsset`, `deleteAsset`, `previewAsset`, `assetBytes`, `publicAsset`, `memberEventAsset`, `assetPermission`, `assetKinds` |
| Decode and re-encode | `lib/assets/image.ts`: `sanitiseImage`, `readImageForm`, `MAX_IMAGE_BYTES`, `AssetError` |
| Object storage client | `lib/assets/storage.ts`: `assetStorage` |
| What references an image | `lib/assets/references.ts`: `assetPublicReferenced`, `assetReferenced` |
| Cleanup and inspection | `lib/assets/maintenance.ts`: `maintainAssets`, `inspectAssetObjects`, `inspectAssets`; CLI `scripts/maintain-assets.mjs` (`pnpm assets:maintain`) |
| Profile read and save | `lib/organisations/profile.ts`: `profileSchema`, `readProfile`, `updateProfile`, `readChargeReadiness`, `readTimeZone` |
| Public profile | `lib/organisations/public-organisations.ts`: `publicOrganisation`, `publicProfileSelect` |
| Directory search | `lib/organisations/discovery.ts`: `discoveryInput`, `discoverOrganisations` |
| Join and leave | `lib/organisations/join.ts`: `setSocietyJoin`, `joinedOrganisationIds` |
| Create a society | `lib/organisations/bootstrap.ts`: `bootstrapOrganisation` |
| Locks with live authority | `lib/organisations/authority.ts`: `lockOrganisationActor`, `organisationIdBySlug` |
| Route helpers | `lib/organisations/http.ts`: `organisationActor`, `organisationError` |
| Dashboard overview data | `lib/organisations/overview.ts`: `getOrganisationOverview`, `getDoorDay`, `upcomingEventCounts` |
| Routes | `POST /api/orgs`, `GET`/`PATCH /api/orgs/[orgSlug]/profile`, `POST /api/orgs/[orgSlug]/join`, `POST /api/orgs/[orgSlug]/leave`, `GET /api/orgs/search`, `GET /api/public/organisations/search`, `POST /api/orgs/[orgSlug]/assets`, `GET`/`DELETE /api/orgs/[orgSlug]/assets/[assetId]`, `GET /api/public/assets/[assetId]` |
| Pages | `/dashboard/settings/profile`, `/dashboard/organisations`, `/societies`, `/societies/[orgSlug]` |
| UI | `components/settings/society-profile.tsx`, `components/organisations/society-header.tsx` |
| Tests | `tests/integration/assets.test.ts`, `tests/integration/society-profiles.test.ts`, `tests/integration/society-discovery.test.ts`, `tests/integration/event-hero.test.ts` |

## Creating a society

`POST /api/orgs` (`bootstrapOrganisation`) for a verified `organisation` account: trusted origin, rate bucket `organisation_create`, `createOrganisationSchema`; a name or slug with no letters or numbers is 400.

- Under the User lock it finds societies the account already points to (`accountUserId`) or holds active staff on, locks them in id order, and refuses if any exist. Revoked staff rows alone don't block. Handover never restores a retired pointer, so it can't re-enable a second society.
- Creates the society (with `accountUserId`, which also satisfies DEF-040), an `org_owner` join row, an active `owner` staff row and `organisation.created` in one transaction. Only a slug collision is retried, with a numeric suffix.
- The 201 response deletes the dashboard context cookie, so a stale context can't hide the new society; the dashboard then opens profile setup.

## Profiles and onboarding

- **Editor:** `/dashboard/settings/profile` (`organisation:settings` and staff MFA). Four steps: identity, branding, policies, finish. Continuing keeps edits; save writes the whole profile. The finish step shows completion, charge readiness as last recorded from Stripe (only with `stripe:manage`) and team size (only with `staff:manage`).
- **Fields** (`profileSchema`): name 1 to 120, description up to 5000, `supportEmail` (blank or an email), `refundPolicy` (one policy shown at every checkout, labelled "Refund policy for tickets, memberships and merchandise" with an example, and shown to buyers as "Refund policy:"; UI-009) and `pickupPolicy` up to 5000, `timeZone` (an IANA zone from the server's list; the stored value is always offered), `logoAssetId`, `coverAssetId`, plus `expectedProfileVersion`. Slug, owner, Stripe fields, completion and version can't be set by PATCH. `Organisation_profile_bounds_chk` backs the lengths.
- **Completion:** `onboardingCompletedAt` is set when name, description and a separately supplied `supportEmail` are present, and cleared if one is removed. Contact never defaults to an account's private email. Incomplete profiles stay public and listed.
- **Save** (`PATCH /api/orgs/[orgSlug]/profile`): trusted origin, rate bucket `organisation_profile`, 80,000-byte body cap, then under User, Organisation and sorted Asset locks it rechecks live authority and MFA, compares `profileVersion` (409 on a stale one), and accepts a logo or cover only if it is a ready, undeleted asset of this society with the matching `kind`. Audits `organisation.profile_updated` with the changed field names.
- **Pickup details:** a society can't clear `pickupPolicy` while any merchandise product is published (400), because buyers must always see them.
- **Conflict UI:** a stale save keeps the editor's values and offers Save my version (re-reads the latest `profileVersion` and saves over it) or Reload latest profile (discards after confirmation).
- `timeZone` (default `Australia/Brisbane`) drives every society date: events, plans, analytics, the calendar.

## Public profile and directory

- **Profile page** `/societies/[orgSlug]` uses `publicProfileSelect` (whitelisted fields) and lists at most 50 upcoming published `public` events. Text is escaped. `components/organisations/society-header.tsx` shows cover, logo and name, the viewer's Joined badge and, separately, Member until while a membership runs, then the tabs: Overview, Memberships (only while a plan is on sale) and Merchandise (only while a product is on sale) ([[Memberships and Merchandise]]). Overview shows About, the join card, upcoming events with each one's price or selling state, and previews of the soonest membership plan and the four newest products. No cover shows a neutral placeholder; no logo shows the society's initial. Society surfaces use namespaced tokens ([[UI Architecture Rules]]).
- **Directory** `/societies` (anonymous): name, slug, description cut to 240 characters, logo and the next upcoming public published event. Search matches name or slug, case-insensitive, with `%`, `_` and `\` taken literally; queries up to 120 characters; `limit` 1 to 50 (default 25); ordered by name then id; opaque forward cursors bound to the query. Invalid input is 400.
- `GET /api/public/organisations/search` carries no join state, contact, staff, Stripe or roster fields and is cacheable (`public, max-age=60`). `GET /api/orgs/search` adds the caller's `joined` flags, answers `private, no-store`, and keeps its original envelope unless `limit` or `cursor` is sent.

## Joining and leaving

- Joining is free affiliation (`OrganisationMember`, role `member`): the Joined badge, never staff authority, member prices or members-only access.
- `POST /api/orgs/[orgSlug]/join` needs a verified `member` account; `POST /api/orgs/[orgSlug]/leave` needs a `member` account. Both: trusted origin and rate bucket `organisation_join_leave`. Organisation accounts are refused; unverified accounts are offered verification.
- `setSocietyJoin` locks and rechecks the User, then the Organisation, and upserts or deletes only the caller's row. Repeats are idempotent.
- Leaving keeps staff authority, orders, tickets and paid memberships. Navigation or sign-in never joins anyone.
- `/dashboard/organisations` manages joins, including for member accounts who are also staff, without changing their selected staff context.

## Asset contract

### Upload

`POST /api/orgs/[orgSlug]/assets?kind=logo|cover|event|product` with one multipart `file`.

- Permission by kind (`assetPermission`): `logo` and `cover` need `organisation:settings`, `event` needs `events:manage`, `product` needs `merchandise:manage`. Trusted origin, live staff authority, MFA, and the `asset_upload` rate bucket checked per actor and per society, failing closed ([[Route Security Inventory#Rate limits]]).
- Input: JPEG, PNG or WebP, at most 5 MiB (`MAX_IMAGE_BYTES`; the form reader allows 64 KiB of multipart overhead), static, at most 4096 × 4096. Structural checks refuse trailing data and mismatched declarations. `sharp` decodes strictly and re-encodes to static WebP without metadata.
- Quota per society, counted under the Organisation lock over undeleted assets: 100 images and 250 MiB (429 "Society image storage quota reached").
- The object key is `assets/{uuid}.webp`; filenames and URLs never become keys.
- Two transactions around the upload: reserve a `pending` row (with the quota check), put the bytes and verify them with a HEAD outside any lock, then under User, Organisation and Asset locks recheck the session version, authority and MFA and mark `ready` with `asset.uploaded`. Any failure marks the row `failed` and keeps its key so cleanup can remove the bytes.
- Uploading never makes an image public.

### References

`lib/assets/references.ts` holds the two predicates; keep them separate so a new private reference can't become public by accident.

| Predicate | True when |
| --- | --- |
| `assetPublicReferenced` | A society's logo or cover; the hero image of a published, not members-only event; a photo of a published product |
| `assetReferenced` | Any of the above, or any event hero or product photo, published or not |

Composite foreign keys (`(assetId, organisationId)`) make the database refuse another society's image on a profile, event or product. Every attach or detach refreshes `unreferencedAt` (null while referenced, now when the last reference goes).

### Delivery

- **Private preview** `GET /api/orgs/[orgSlug]/assets/[assetId]`: authenticates before saying whether the image exists, needs the permission for its kind, serves ready images only, `private, no-store`, `nosniff`.
- **Public** `GET /api/public/assets/[assetId]`: serves a ready image only while `assetPublicReferenced` holds, as `image/webp` with `nosniff`, ETag = the content hash and `public, max-age=300`. Anything else is 404.
- **Members-only event images** are not public: the same route serves them only to a signed-in verified member whose live membership of that society carries `members_only_events` (`memberEventAsset`), as `private, no-store`, never on the shared cached path.
- **Bytes are checked:** `assetBytes` refuses an object whose size or SHA-256 differs from the row (404).
- **SEC-021:** a matching `If-None-Match` is 304 and a HEAD is 200 with `Content-Length`, both answered from the row without reading storage. `assetStorage` keeps one S3 client (one connection pool) per process and configuration; every call has a 10-second timeout, and provider errors map to 503 without echoing the provider message.

### Delete and cleanup

- `DELETE /api/orgs/[orgSlug]/assets/[assetId]` (rate bucket `asset_delete`): 409 while referenced or still uploading. It marks the row `deleted` with `asset.deleted`, then deletes the bytes and sets `deletedAt`. A repeat finishes an interrupted storage delete without a second audit row.
- `pnpm assets:maintain` (`maintainAssets`) is a dry run by default; `--apply` deletes rows marked `deleted` and images unreferenced for 24 hours, under Organisation and Asset locks, rechecking references, auditing `asset.orphan_removed`. It processes 100 rows per run and prints `nextCursor` for `--cursor`. `--objects` lists bucket objects with no row (never deletes them); `--integrity` checks ready objects' size and hash. Never delete unfamiliar bucket objects automatically.

## Storage and recovery

- **Development:** `docker-compose.dev.yml` runs an `object-store` service built from `docker/Dockerfile.assets` (S3-compatible, authenticated, non-root, read-only filesystem, ports not published) with the persistent `asset_data` volume, and points the app at bucket `thunderstrux-assets`. Its credentials are local-only. Keep the volume across restarts.
- **Hosted:** combine `docker-compose.hosted.yml` with `docker-compose.assets.hosted.yml`, which mounts the access and secret keys as Docker secrets (`_FILE` forms read by `docker/entrypoint.sh`). Storage values never go in `NEXT_PUBLIC_*` variables ([[Environment Variables]]).
- **Backups need both halves:** the `Asset` rows in Postgres and the object bytes. A database-only restore leaves images 404 (`assetBytes` fails the size and hash check). Pause uploads and cleanup during recovery, restore into isolated targets, then run `pnpm assets:maintain -- --integrity` and `--objects` before resuming ([[Production Operations]]).
- Rolling code back keeps the additive asset and profile columns and the object bytes.

## Traps

- Don't serve image bytes on a 304 or HEAD path; answer from the row (SEC-021).
- Don't make `assetReferenced` and `assetPublicReferenced` one function.
- Don't create an `S3Client` per request; use `assetStorage()`.
- A new image kind needs a permission in `assetPermission`, a reference in both predicates, and a composite foreign key.
- Lock order for asset writes: User, Organisation, then Asset (sorted when several); an event locks its Event before the Asset ([[Database and Multi Tenancy#Lock order]]).

## Failure and recovery

| Symptom | Cause | Fix |
| --- | --- | --- |
| 503 "Image storage is not configured" | Missing bucket or keys, or an endpoint without `http(s)://` | Set the storage env vars ([[Environment Variables]]) |
| 503 "Image storage is temporarily unavailable" | Provider error or 10-second timeout | Check the object store; rows stay `pending` or `failed` and are retried or cleaned |
| Images 404 after a restore | Bytes missing or different from the row | Restore the object store; check with `--integrity` |
| 429 on upload | Quota or `asset_upload` bucket | Remove unused images or wait |

## Related

[[Database and Multi Tenancy]] · [[Event Lifecycle]] · [[Memberships and Merchandise]] · [[Authentication and Dashboard Access]] · [[Route Security Inventory]] · [[Audit Coverage]] · [[Production Operations]] · [[Environment Variables]]
