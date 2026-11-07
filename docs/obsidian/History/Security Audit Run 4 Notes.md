---
status: historical
last-reviewed: 2026-11-07
owner: engineering
related: ["[[Issue and Defect Register]]", "[[Resolved Defects]]", "[[Pre-hosting Candidate]]", "[[Project Handover]]"]
---

# Security Audit Run 4 Notes

> Historical record. The run-4 audit (scoped standard run at `0b4b4609`, kept outside the repository at `~/security-audit-skill/thunderstrux/run-4`) left 129 hardening notes beside its 11 findings and 5 leads. This note records what became of each. Current behaviour is in the living notes; open risks are in the [[Issue and Defect Register]].

Notes are numbered by their order in the run's `HARDENING-NOTES.md`: A#1 to A#60 are the bullets of its first 112 lines, B#1 to B#69 the rest. The findings and leads themselves are in [[Resolved Defects]] (PAY-090 to PAY-097, SEC-075, DEF-102, SEC-077 to SEC-086).

**Outcomes:** Accepted 53, Dropped 13, Fixed 30, Registered 17, Duplicate 11, Owner 5.

- **Fixed:** in audit-4 PR 1 (#301), PR 2 (#303) or PR 3, with the record that holds it.
- **Duplicate:** the same root cause as a run-4 finding or lead, fixed there.
- **Registered:** already covered by a register row or a Resolved Defects record, which stays as it is.
- **Owner:** configuration or a check outside the repository, now on the go-live checklist in [[Pre-hosting Candidate]].
- **Accepted:** true, but the cost of a change outweighs a bounded effect; the reason says why.
- **Dropped:** not a defect at this revision.

## A notes

| Note | Claim | Outcome | Reason |
| --- | --- | --- | --- |
| A#1 | CSP keeps script `'unsafe-inline'` | Accepted | A nonce would make every page dynamic, and there is no HTML sink today. |
| A#2 | No Cross-Origin-Opener-Policy | Accepted | An opener can only navigate, which any link can already do; capture still needs a click. Revisit with the next header change. |
| A#3 | Deep JSON throws in stringify | Dropped | The only loose field (`selection`, http.ts:22) is parsed by its family's schema before hashing. |
| A#4 | request-bounds test gaps | Accepted | Bytes are counted correctly and a non-numeric length falls through to the stream cap. The auth 10 KB cap is already tested. |
| A#5 | ops:deploy accepts legacy `allow` | Fixed: SEC-085 |  |
| A#6 | Dev server answers no-Origin clients | Registered: SEC-014 | Docs already forbid tunnelling `next dev`. |
| A#7 | Unverified manager edits staff | Accepted | Only pre-verification legacy owners, and a fresh MFA code is still required (route.ts:56-59). |
| A#8 | Revocation keeps invitations the member issued | Accepted | A live-issuer check runs at delivery and at acceptance. Revival needs an owner to reinstate the member, and the invitations stay listed. |
| A#9 | Prisma engines trust vendor CDN | Accepted | TLS, vendor checksum and Trivy/SBOM cover it. Pinning adds work on every Prisma bump. |
| A#10 | `.impeccable` locals ignored only locally | Fixed: SEC-086 |  |
| A#11 | Flight decoder advisories fixed | Dropped | No defect, as the note says. |
| A#12 | No `serverActions.bodySizeLimit` | Duplicate of C2 (SEC-078) |  |
| A#13 | `staffMfaSessionId` in client session | Accepted | Not a credential. Script that can read it can already act as the user. |
| A#14 | Admin GET pages write trail rows | Accepted | Loopback-only portal, so this is trail noise. A Sec-Fetch-Site filter would drop real views made from links. |
| A#15 | Ticket targets use denormalised orgId | Registered: DATA-001 | The ids come from the society's own rows. Optional one-liner. |
| A#16 | Private asset route has no 304/HEAD shortcut | Accepted | Authenticated, same tenant, capped at 5 MiB. SEC-021 covered the public route only. |
| A#17 | GETs with side effects reachable cross-site | Accepted | Nothing leaks. Worst case burns the 20-per-hour export budget. |
| A#18 | Webhook doesn't refuse `event.account` | Accepted | Each endpoint has its own secret, and settlement re-reads the Session on the platform account. |
| A#19 | Stale "event loop" comment | Fixed: SEC-083 (comment) |  |
| A#20 | Account switch leaves the old MFA grant | Registered: SEC-070 | Risk from a copied JWT is already accepted. |
| A#21 | Batch requeue charges society budget once | Fixed: SEC-084 |  |
| A#22 | No per-society enquiry cap | Accepted | Needs many IPs, and token mail goes out first. A cap would let the same attacker silence the form. |
| A#23 | Public search cached 60 s | Accepted | Public data. A minute of staleness is fine. |
| A#24 | Admin action ids in the public bundle | Duplicate of C2 (SEC-078) |  |
| A#25 | e2e image copies local tool files | Fixed: SEC-086 |  |
| A#26 | 503 still counts on upload budget | Registered: SEC-071 | The budget is per actor and society, so no cross-society burn. |
| A#27 | CI smoke AUTH_SECRET passes the production check | Fixed: SEC-086 |  |
| A#28 | Pointer society labelled org_owner after demotion | Duplicate of C10 (SEC-080) |  |
| A#29 | Worker pool ignores cgroup quota | Dropped | Node 22 caps `availableParallelism` at the cgroup quota, so `APP_CPUS=1.0` gives one worker, as run 4's N1 measured. |
| A#30 | Dead reset token still costs a hash | Fixed: SEC-083 |  |
| A#31 | Return paths keep fragments | Fixed: SEC-083 |  |
| A#32 | Guest name set by link requester | Accepted | Limited to 3 an hour, the victim must redeem the swapped link, and the name is cosmetic. |
| A#33 | Organisation account can claim guest order | Fixed: SEC-083 |  |
| A#34 | Guest session can't be ended | Fixed: SEC-083 (browser-session cookie, cleared at sign-out; no guest Done button) |  |
| A#35 | Reset takeback keeps squatter's account type | Accepted | Rare. The owner can close the account and sign up again. |
| A#36 | Guest recovery timing hints at purchases | Accepted | Weak signal, already limited by the guest_email buckets. |
| A#37 | Coverage note's gate premise is wrong | Dropped | This is the audit's own wording; the register already says the 9th check gets 503. |
| A#38 | Compare outlasts tx timeout, gives 500 | Duplicate of C1 (SEC-077) |  |
| A#39 | Public readiness could fail a deploy | Registered: SEC-053, SEC-019 | Owner decision to keep it public. |
| A#40 | Handover locks users before compare | Duplicate of C1 (SEC-077) |  |
| A#41 | Closure or disable leaves Connect control | Duplicate of N2 (PAY-096) |  |
| A#42 | Closed operator stays `active` | Fixed: SEC-083 |  |
| A#43 | No post-lock session check | Accepted | Attaching refuses a second Session. |
| A#44 | Evidence staged once, after commit | Accepted | The draft is a convenience; the evidence-due monitor alerts before the deadline. |
| A#45 | `getGuestOrder` has no identity filter | Registered: DEF-097 | The only caller binds identity first (guest-access.ts:119). |
| A#46 | Pool size follows host cores | Owner: Go-live checklist: database pool |  |
| A#47 | Missing APP_URL/EMAIL_FROM throws in money tx | Dropped | Already required. |
| A#48 | No key id on notification envelope | Owner: Go-live checklist: notification key; register OPS-010 |  |
| A#49 | Restricted society's event readable by id | Dropped | By design, for ticket holders (commented). |
| A#50 | Draft titles shown to finance_manager | Accepted | The role has events:read and already sees the events list. |
| A#51 | Cancellation runs in one 120 s tx | Accepted | Society events are small. |
| A#52 | Formula after a comma not defused | Fixed: SEC-084 |  |
| A#53 | Other format chars before `=` | Fixed: SEC-084 |  |
| A#54 | Cookies lack `__Host-` prefix | Accepted | Needs cookie injection from a related domain. Renaming signs everyone out. |
| A#55 | Revoked member can rejoin | Accepted | Product decision. |
| A#56 | Ended free membership can be cancelled | Accepted | Cosmetic. |
| A#57 | Revoked grant may get a reminder | Accepted | Email noise. |
| A#58 | Second basket during webhook grace | Accepted | Lasts until the expiry webhook or sweep. The fix would block the buyer's retry after an expired page. |
| A#59 | Restocking return before pickup | Fixed: DEF-102 |  |
| A#60 | Staff-end actions skip the locked recheck | Accepted | Millisecond window after the route's check. |

## B notes

| Note | Claim | Outcome | Reason |
| --- | --- | --- | --- |
| B#1 | /api/health/ready is anonymous: DB transaction + Redis per call | Owner: Go-live checklist: edge limits |  |
| B#2 | Same; suggests an in-process cache | Owner: Go-live checklist: edge limits |  |
| B#3 | Signature-alert cooldown shared by three webhooks | Accepted | Needs a flood and a real secret mismatch at once; every request is still logged |
| B#4 | Context can overwrite level/event/timestamp | Accepted | No caller passes those keys |
| B#5 | BigInt payload silently drops an alert | Accepted | No payload carries a BigInt |
| B#6 | $queryRawUnsafe with table names | Dropped | Names come only from const tuples |
| B#7 | Prisma error log skips redaction | Accepted | Operator-only stderr (LOG-001). |
| B#8 | Enquiry 404 shows every owner is disabled | Accepted | A rare support state, no personal data |
| B#9 | `unpaid` read before the close fallback | Accepted | Unreachable while card-only (checkout-creation.ts:521) |
| B#10 | Notices labelled with Order.organisationId | Registered: DATA-001 | Denormalized-drift accepted risk |
| B#11 | Review with no tickets picked needs no code but forecloses a void | Registered: PAY-084 | Deliberate: only a pick voids, so only a pick needs a code |
| B#12 | Evidence quotes today's refund policy | Accepted | Labelled "current wording", staged for review |
| B#13 | Compensation batch has no per-item catch | Accepted | Runs each minute; the job stays leased; worker_failed alerts |
| B#14 | Failed reversal stops holding the sale | Accepted | Alert fires; a manual reversal can still debit the society (PAY-022) |
| B#15 | Checkout checks codes without ticket_code_check | Accepted | checkout_create (5 per 10 min per identity) is tighter than 600 per address |
| B#16 | Late honour exceeds code maxUses | Registered: EVT-007 | Exactly this |
| B#17 | event_draft reveals a draft exists | Dropped | Needs an unguessable, unlinked cuid |
| B#18 | Compensation batch breaks at an ineligible job | Accepted | Worker runs every minute (docker-compose.schedules.yml:24) |
| B#19 | reversesTransfer ignores whether the rest covers the refund | Accepted | Fails safe to refund_failed plus alert |
| B#20 | Publish readiness read outside the lock | Accepted | Checkout rechecks under the event lock |
| B#21 | Appeal drops the lost_after_restore alert | Fixed: PAY-068 note (PR 1) |  |
| B#22 | Outside refund after a part loss ignores the lost amount | Accepted | Review stays open; the PAY-082 pick covers it |
| B#23 | Prevented part-resolution strands tickets | Registered: PAY-075 | Owner maps resolutions |
| B#24 | Migration skips restored legacy prevented rows | Dropped | Pre-production; no such rows |
| B#25 | Win after part loss over-reverses a one-ticket refund | Fixed: Payment Disputes wording (PR 1) |  |
| B#26 | Manual-schedule repair skips payouts-disabled accounts | Fixed: PAY-093 |  |
| B#27 | Unexpected-payout alert keyed on the insert | Accepted | Hourly run re-asserts manual; the residual is one lost alert |
| B#28 | Unrecorded paid sale counted as releasable | Accepted | Needs a delayed webhook at the payout; bounded by one sale |
| B#29 | Marked-refunded cancelled sale released early | Registered: PAY-045 | Documented design |
| B#30 | Non-dispute holds end silently at the cap | Fixed: PAY-094 |  |
| B#31 | Hold remedy buys only about 10 days | Owner: Hold-remedy runbook (PR 1) |  |
| B#32 | Release/lift confirmations don't list open disputes | Accepted | dispute_hold_ending gives a week's notice |
| B#33 | Hold-ending alert logged hourly | Dropped | Log volume only; dedupeKey dedupes |
| B#34 | MFA/legacy dev defaults key on NODE_ENV | Accepted | Images build with production defaults, and deploys refuse anything but `enforce` and `deny` (SEC-085). |
| B#35 | Owner count includes disabled owners | Fixed: SEC-080 |  |
| B#36 | Payout-account change raises no alert | Duplicate of N2 (PAY-096) |  |
| B#37 | Recovery notice silent on the Express sign-in | Duplicate of N2 (PAY-096) |  |
| B#38 | Admin cookie reaches every localhost port | Fixed: Platform Admin Portal wording (SEC-082) |  |
| B#39 | Host rule only in proxy.ts | Accepted | All admin routes sit under the matcher |
| B#40 | Pruned "told" rows let a stale recovery complete | Fixed: SEC-082 |  |
| B#41 | Completion reinstates a claimant the society revoked | Fixed: SEC-082 |  |
| B#42 | Authenticator reset ignores the holder's later verification | Fixed: SEC-082 |  |
| B#43 | Ownership notice misses owners added during the 72 h | Fixed: SEC-082 |  |
| B#44 | Completion overwrites a longer hold's reason | Fixed: SEC-082 |  |
| B#45 | Restriction leaves open Sessions payable | Accepted | ≤30 min window; payouts held, so buyers can be refunded |
| B#46 | Guest session still opens a claimed order | Dropped | Same verified email, same person |
| B#47 | Edge rule for buyer order pages | Duplicate of N4 (PAY-097) |  |
| B#48 | Stored callback keeps the #fragment | Fixed: SEC-083 |  |
| B#49 | IPv6 keyed per /64 | Registered: SEC-019 | Pre-hosting edge row: "confirm how IPv6 clients are keyed" |
| B#50 | Notification cleanup unordered; kept rows fill the batch | Registered: OPS-009 | Cheap close-out: filter in SQL, order by updatedAt |
| B#51 | One door user drains the society's check-in bucket | Registered: SEC-039 | Names the 300/min society bucket |
| B#52 | requireFreshStaffMfa doesn't throttle itself | Accepted | Every caller throttles first |
| B#53 | Wrong password keeps the TOTP step | Accepted | Attacker already needs the session and the phone |
| B#54 | Enrolment doesn't delete old codes | Accepted | Every reset path deletes them |
| B#55 | CSRF prefers the __Secure- cookie | Dropped | https in production; fails closed |
| B#56 | Revoking the Express onboarder gives no warning | Duplicate of N2 (PAY-096) |  |
| B#57 | getAppUrl falls back to localhost | Dropped | Compose requires it (docker-compose.hosted.yml:32) |
| B#58 | Unsigned webhooks cost logs and hashing | Registered: PAY-023 | Edge rule |
| B#59 | v2 refresh re-reads before the lock | Accepted | Stripe enforces; the next event corrects it |
| B#60 | Connect-link hold check unlocked | Accepted | One-request window, like accepted PAY-089 |
| B#61 | Default retries on an advisory read | Duplicate of N4 (PAY-097) |  |
| B#62 | ops:deploy accepts the Caddy header with no Caddy | Fixed: SEC-085 |  |
| B#63 | --local skips validateHostedConfig | Accepted | A host shell can bypass anything anyway |
| B#64 | Recovery codes left to a manual DELETE | Registered: SEC-054 | Runbook step 4 names it |
| B#65 | .dockerignore key rules root-anchored | Fixed: SEC-086 |  |
| B#66 | Rehearsal seeds have no DB guard | Fixed: SEC-086 |  |
| B#67 | Deploy bundle not tied to revision; downgrades allowed | Accepted | Operator-only; revisit with OPS-008 |
| B#68 | release.yml job-level write permissions | Registered: SEC-074 | Exactly this |
| B#69 | Same as #62 | Fixed: SEC-085 |  |
