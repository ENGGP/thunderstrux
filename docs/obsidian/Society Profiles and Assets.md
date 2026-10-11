---
status: living
last-reviewed: 2026-10-11
owner: engineering
related: ["[[API Reference]]", "[[Database and Multi Tenancy]]", "[[Production Operations]]"]
sources: [lib/assets, lib/organisations, prisma/schema.prisma, docker-compose.dev.yml]
---

# Society Profiles and Assets

Package 3 is being delivered in dependency order: safe assets (T07), profiles/onboarding (T08), then discovery/join (T09). Implementation is not hosted activation; qualification evidence belongs in the readiness ledger and PR.

## Profiles and Onboarding

`/dashboard/settings/profile` requires live organisation settings authority and staff MFA. Its four steps save identity, optional branding and public operating policies, then show completion and links to implemented staff/security/payment settings. Saves retain unsaved local edits on failure; an optimistic version conflict requires an explicit reload, with confirmation before discarding edits. Continuing between steps keeps edits; save publishes the supplied profile fields.

Profile completion requires a name, description and separately supplied valid public contact email. Existing profiles remain discoverable while incomplete. Contact does not default to the account's private email. Optional refund/pickup policies and IANA timezone are public; these fields do not change existing checkout/refund rules or Stripe readiness. Slug, tenant owner, Stripe fields and server completion/version timestamps cannot be edited through PATCH.

`GET/PATCH /api/orgs/[orgSlug]/profile` exposes an explicit profile DTO. PATCH accepts the full editable field set plus expectedProfileVersion, bounds the body, requires origin/CSRF and fail-closed rate protection, then rechecks live session/permission/MFA under User -> Organisation -> sorted Asset locks. Version conflicts return 409; valid ready logo/cover images must match both society and slot. Composite database foreign keys additionally prevent cross-tenant references. Attaching clears the orphan clock; detaching starts a new 24-hour grace. Public delivery and all-reference deletion checks are separate predicates so future private content cannot accidentally become public.

Bootstrap reserves the verified organisation account under its User lock and locks existing societies in ID order. Either a retained bootstrap pointer or active staff authority blocks another primary society, including after handover retires the pointer. Historical revoked rows alone do not block a new primary. Bootstrap creates the compatibility join row, active named owner and audit atomically; only slug uniqueness conflicts are retried. The new society clears stale dashboard context and opens profile setup. Handover never restores a retired pointer.

Public `/organisations/[orgSlug]` uses a whitelisted profile DTO and at most 50 upcoming published events. All text is escaped; only implemented Overview/Events sections appear. Namespaced purple tokens in app/globals.css apply to these society surfaces and the explicit society button variant; existing button defaults and other pages keep their current styling.

Apply 20261011020000_society_profiles before the profile app release. Its fields/defaults are additive; existing societies gain empty public contact/policies and Australia/Brisbane timezone. Keep fields/references when rolling code back. Recovery verifies profile completion/version/contact and logo metadata/object association together.

## Safe Asset Contract

`POST /api/orgs/[orgSlug]/assets?kind=logo|cover|event|product` accepts one multipart `file`. Logo/cover requires organisation settings permission, event requires event management and product requires merchandise management. Requests retain trusted origin/CSRF, live identity, staff authority, MFA and fail-closed upload protection. Actor and tenant upload buckets each allow 20 attempts/hour. Delete allows 30 requests/10 minutes per actor/tenant. Quotas reserve pending and retained objects under tenant locks: 100 assets and 250 MiB per society.

JPEG/PNG/WebP input is limited to 5 MiB and 4096 by 4096 decoded dimensions. Structural checks reject trailing payloads and invalid format declarations; strict decoding/re-encoding emits static WebP without original metadata. Original filenames/remote URLs never become object keys. PostgreSQL stores metadata and ownership; S3-compatible storage holds only processed bytes.

`GET /api/orgs/[orgSlug]/assets/[assetId]` is an authorised preview with private/no-store headers. `DELETE` denies referenced or uploading assets and creates an audited tombstone before deleting bytes. Repeat deletion recovers interrupted storage deletion without duplicate audit entries. Uploaded images are not automatically public.

`GET /api/public/assets/[assetId]` serves only ready images referenced by public content, with an explicit WebP content type, nosniff, content-hash ETag and five-minute cache lifetime. Unattached/pending/deleted assets return 404. Profile logos/covers are the current public reference consumer; other uploads remain private previews.

Uploads move pending -> ready only after storage verification and a transaction rechecking session version, live permission and MFA. Provider/authority failures retain a failed record/key for recovery. No provider call occurs while database locks are held. Lock ordering is User -> Organisation -> Asset.

## Local Storage and Recovery

Development Compose builds SeaweedFS 4.48 from checksum-pinned upstream source with digest-pinned Go 1.27.2/Alpine images and the patched x/net 0.60.0 dependency. The upstream binary failed the initial fixable high/critical scan, so it is not the delivery image. The local image uses S3 authentication, a non-root/read-only runtime and a persistent `asset_data` volume. Its synthetic credentials are local-only and the storage ports are not published. Restarting the app must preserve the volume. Existing development resources are not recreated by validation.

Hosted storage uses ASSET_STORAGE_ENDPOINT, ASSET_STORAGE_BUCKET, ASSET_STORAGE_REGION and ASSET_STORAGE_PATH_STYLE. Combine `docker-compose.hosted.yml` with `docker-compose.assets.hosted.yml` to mount the two external storage secrets. ASSET_STORAGE_ACCESS_KEY and ASSET_STORAGE_SECRET_KEY remain server-only; the container entrypoint also supports their `_FILE` forms. Actual secret mounts, bucket configuration, HTTPS and provider acceptance must be supplied and verified before hosted activation. Do not put storage values in NEXT_PUBLIC variables or commit credentials.

Run `pnpm assets:maintain` inside the configured Docker environment for a bounded dry-run; add `--apply` to delete eligible unreferenced objects after a 24-hour grace. A run processes at most 100 rows and emits a nextCursor, accepted through `--cursor`. Deleted tombstones retry immediately. `--objects` performs bounded object-to-metadata inspection without deletion; `--integrity` checks ready object size/hash against its metadata. Never delete unfamiliar bucket objects automatically.

Apply the additive asset migration once before rolling out its app code. Back up both PostgreSQL metadata and object bytes; database-only restore does not restore images. Pause uploads/cleanup during recovery, restore into isolated targets and verify hashes/ownership before resuming. Keep additive tables and object bytes on code rollback. Hosted scheduling and off-machine backup/restore remain activation gates.
