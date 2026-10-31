---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Payment Lifecycle]]", "[[Database and Multi Tenancy]]", "[[Event Lifecycle]]", "[[Society Profiles and Assets]]", "[[Email Delivery Implementation]]"]
sources: [lib/memberships/plans.ts, lib/memberships/grants.ts, lib/memberships/offers.ts, lib/memberships/roster.ts, lib/memberships/revocation.ts, lib/memberships/reminders.ts, lib/memberships/http.ts, lib/merchandise/catalogue.ts, lib/merchandise/shop.ts, lib/merchandise/basket.ts, lib/merchandise/sale.ts, lib/merchandise/pickups.ts, lib/merchandise/after-sale.ts, lib/commerce/families.ts, lib/commerce/orders.ts, lib/events/public-events.ts]
---

# Memberships and Merchandise

**Owns:** the product rules of the two commerce families a society sells besides tickets: membership plans, grants, member prices and members-only events; merchandise products, the shop, pickups and returns; and their buyer and staff pages.
**Read when:** changing plans, grants, member benefits, products, options, stock, pickups or returns.
**Not here:** shared commerce orders, holds, checkout attempts, refunds, disputes and compensation ([[Payment Lifecycle]]); Stripe Sessions and webhooks ([[Stripe Payments and Connect]]); tables, constraints and triggers ([[Database and Multi Tenancy]]); image storage ([[Society Profiles and Assets]]); email delivery ([[Email Delivery Implementation]]).

## Code

| Concern | Where |
| --- | --- |
| Family registry (quote, lock, fulfil hooks) | `lib/commerce/families.ts`: `commerceFamilies` |
| Plans | `lib/memberships/plans.ts`: `planFieldsSchema`, `planReadiness`, `termFromDays`, `daysFromTerm` |
| Grants and the membership family | `lib/memberships/grants.ts`: `membershipFamily`, `grantState`, `activeEntitlementGrant`, `memberPriceTicketCount` |
| What members see | `lib/memberships/offers.ts`: `membershipOffers`, `myMemberships`, `entitlementOnSale`, `memberPriceUnused` |
| Roster | `lib/memberships/roster.ts` |
| Revoke, cancel, refund | `lib/memberships/revocation.ts`: `revokeMembership`, `cancelFreeMembership`, `refundMembership`; route helper `staffEndRoute` in `lib/memberships/http.ts` |
| Renewal and expiry notices | `lib/memberships/reminders.ts`: `queueMembershipNotices` |
| Catalogue | `lib/merchandise/catalogue.ts`: `productFieldsSchema`, `productReadiness`, `MAX_OPTIONS`, `MAX_PHOTOS` |
| Shop and quote | `lib/merchandise/shop.ts` (`hasShop`); basket `lib/merchandise/basket.ts` (browser) |
| Sale, holds, fulfilment | `lib/merchandise/sale.ts`: `merchandiseFamily`; holds `heldByVariant` |
| Pickups | `lib/merchandise/pickups.ts`: `pickupStepSchema` |
| Staff order page, refund, free cancel, returns | `lib/merchandise/after-sale.ts`: `staffMerchandiseOrder`, `refundMerchandiseOrder`, `cancelFreeMerchandiseOrder`, `recordReturn`, `returnSchema` |
| Commerce order lists | `lib/commerce/orders.ts`: `getOwnCommerceOrders`, `listOrganisationCommerceOrders`, `commerceProductOptions` |
| Members-only gate, prices per viewer | `lib/events/public-events.ts`: `getEventForViewer`, `priceForViewer` |
| Tests | `tests/integration/`: `membership-*.test.ts`, `member-prices.test.ts`, `members-only-events.test.ts`, `merchandise-*.test.ts` |

## Membership plans

A plan (`MembershipProduct`) is one fixed term a society sells: name (1 to 120), description (up to 2000), price, a half-open term `[startsAt, endsAt)` and rights from `MembershipEntitlement` (`member_prices`, `members_only_events`) with an `entitlementVersion`. It is a one-off purchase; it never renews and is never a subscription.

- **Prices** (plans and merchandise options): `priceAmountSchema`, 0 (free) or $2.00 (so the society keeps more than half after the fee) to $999,999.99, in cents.
- **Dates:** staff enter a first and last day. The term runs from midnight starting the first day to midnight after the last, in the society's zone (`termFromDays`; `daysFromTerm` reverses it). A day with no midnight in the zone is a field error. Saving the days the form shows keeps the stored term, so changing the society's zone moves no plan (EVT-010). Presets Semester 1 (1 Jan to 30 Jun), Semester 2 (1 Jul to 31 Dec) and Full year fill both days; all stay editable.
- **States:** `draft`, `published`, `archived`; shown as Draft, Published, Ended (published but past its last day) and Archived. Only published plans not yet ended are on sale. Archive is one way: the plan stops selling and can't be republished; holders keep their terms. Plans are never deleted.
- **Publish check** (`planReadiness`, one rule for button and API; 409 with `reason`): `term_past` (must end in the future); `overlap` (no other published plan of the society overlaps; back-to-back terms are fine because terms are half-open); `payments_unavailable` (a paid plan needs payments; a free one doesn't). Saving a published plan reruns it for anything but a description edit.
- **Sold plans:** once any order line names the plan (pending or paid), name, term, price and rights are locked; only the description changes. `MembershipProduct_preserve_sold` enforces this and never lets a plan change society. Next year is a new plan.
- **Concurrency:** every change holds User, Organisation, then the plan row, with a version check (409 when stale). Checkout locks the Organisation before reading a plan, so it never quotes a plan mid-edit.
- **Access:** live `memberships:manage` (owners, admins) on `/dashboard/memberships` and `/api/orgs/[orgSlug]/memberships`; another society's plan is 404. Audits `membership_plan.created`, `membership_plan.updated`, `membership_plan.published`, `membership_plan.archived`.

## Grants and the roster

A `MembershipGrant` is one member's membership from one purchased line: unique per line, pinned to the line's society, with the plan's term and rights copied on. Its facts never change; it can be revoked once, with a reason (`MembershipGrant_preserve_facts`).

- **State** comes only from the clock and `revokedAt` (`grantState`): `upcoming` before `startsAt`, `active` in `[startsAt, endsAt)`, `expired` from `endsAt`, `revoked` once revoked. No job changes it.
- **Running membership** (`activeEntitlementGrant`): unrevoked, started, not ended, in that society, carrying the right asked for.
- **Roster** (`members:read`, owners and admins): `/dashboard/memberships/members` lists Active, Upcoming, Expired and Revoked grants, newest first, with stable pages and name or email search, and Free joins as a separate list (joiners who also hold a membership are marked). `/dashboard/memberships/members/[grantId]` shows term, rights, source order (Paid or Free and its short reference), the free join, other terms, whether the person is staff and a history (granted, started, ended early). Another society's grant is 404. The page also accepts `orders:read`, so a finance manager can refund from it but sees no revoke.
- **Lists** (UI-025): Plans and Products page 25 at a time and the public shop 24 (whole rows), both ways on the shared cursor.

## Buying a membership

- **Checkout** (`POST /api/payments/checkout/membership`, `membershipFamily`, `selection: {planId}`): verified member accounts only, never guests; one line of quantity 1 at the plan's price. Under the buyer then society locks the quote refuses, each as 409 with that `reason` and nothing charged:
  - `plan_unavailable`: not published, ended, or another society's;
  - `term_overlap`: dates the member already holds;
  - `purchase_in_progress`: dates with another of their checkouts still waiting on Stripe.
- **Renewal** is buying the next plan; a plan starting when the current one ends doesn't overlap.
- **Fulfilment:** a free total grants inside checkout; a paid one only from the verified webhook. Under member, society and order locks the grant is created once (a replay finds it) with a receipt (`membership-receipt/{grantId}`) in the same transaction. If overlapping dates arrived another way meanwhile, the paid order goes to compensation review (`term_overlap`) and no second grant is made.
- **Offers** (`membershipOffers`): published plans still to end, soonest first, each with the viewer's standing: `held` (their plan), `covered` (another of theirs overlaps; no button), `pending` (their checkout is confirming) or `available` (Buy membership, Get free membership, or Renew for {plan} after one they hold). Signed out: Sign in to buy membership; unverified: a verify prompt; society accounts: no button.
- **Society page:** `components/organisations/society-header.tsx` shows Joined and, separately, `Member until {last day}` while a membership runs; the Memberships tab (`/societies/[orgSlug]/memberships`) shows only while a plan is on sale. A free join never shows Member until.
- **Review** (`/societies/[orgSlug]/memberships/[planId]/checkout`): term, unlocks, money, "Your cover" after a held membership, refund policy, support address. Held or confirming dates show the refusal instead of the button, which keeps one idempotency key per intent and names each refusal with "Nothing has been charged".
- **Return page** (`/memberships/orders/[orderId]`, buyer only): Stripe's success and cancel URLs both land here (`?left=1` on cancel). It shows the real state and never fulfils: You haven't paid yet (Return to payment, Cancel order), confirming (polls), You're a member or upcoming, no payment taken, or refunding (compensation).
- **My memberships** (`/memberships`, `myMemberships`): Active, Upcoming, Expired and Revoked tabs. Cards show society, plan, dates in the society's zone, unlocks, Paid or Free, what ended it early and Renew for the next published plan after it that overlaps none of theirs. "Memberships don't renew automatically" stays visible. Tab counts are database counts (`grantViewWhere`, `lib/memberships/roster.ts`).
- **My societies:** Joined, and Member until while a membership runs; leaving says the membership is not affected. Leaving a society removes only the free join.

## Member prices

- `TicketType.memberPrice` is optional, at most `price`.
- **Who pays it:** a member account with a running membership of the event's society carrying `member_prices`. Free joins, upcoming, expired or revoked memberships, memberships without the right, other societies' memberships and all guests pay `price`.
- **Checkout:** under the buyer, event and ticket-type locks the quote uses the member price, so a buyer sending the other price gets the 409 quote change with the price that applies. The order records `membershipGrantId` and `membershipEntitlementVersion` (both or neither; frozen by `Order_preserve_member_price`). A member price of 0 is a free registration with the grant recorded, even when the society can't take payments.
- **One ticket per event (PAY-050),** so one member can't buy for nine others. `memberPriceTicketCount` counts their tickets that aren't void plus live holds, across the event's types, on orders with `membershipGrantId`, under the buyer lock. At 0 they get one ticket at this price (more is 400 `member_price_limit`, before the quote check); above 0 they pay `price`. A refund, release or lapsed hold gives it back. Free member prices and codes follow the rule. A member price equal to `price` neither limits nor uses it. Not rechecked at fulfilment, as EVT-007.
- **Fulfilment** reads the grant `FOR SHARE`: revoked or refunded before payment landed sends the order to compensation review (`member_price_membership_revoked`) with no tickets. A members-only event's order does the same, member price or not (`members_only_access_revoked`, DEBT-002); a membership that simply ended during the hold keeps the price. Issued tickets are never repriced or voided by a later revocation.
- **Display** (`priceForViewer`): a member sees the member price, the standard one struck through, "Member price through your {plan} membership" and `Quantity` limited to 1; once it's used or in an open checkout, the standard price and why. Others see "Members pay $X", that joining doesn't include it, and a link to the memberships page.

## Members-only events

- **Setting:** the builder's Access card offers Members only. Drafts save; publishing needs a published plan still to end that unlocks `members_only_events` (`members_only_unavailable` blocker, [[Event Lifecycle#Publish and unpublish]]). An event stays published after that plan ends.
- **Who can open it:** a verified member account with a running membership of the society carrying `members_only_events`, checked live on every request (`getEventForViewer`). Free joins, other memberships, guests, staff and society accounts don't count; organisers use the dashboard and Preview.
- **The gate:** everyone else on `/events/[eventId]` gets "Members-only event" naming only the society (name, slug, logo) and why: `signed_out`, `unverified`, `no_membership` ("Joining for free doesn't count"), `not_included` or `upcoming` (with its first day). Tab title "Members-only event · {society}", `noindex`, rendered per request with `private, no-store`. Drafts and wrong ids are still not found.
- **Safety contract:** the gate decision reads only the event's id, status, visibility and society; other fields are read only after access is granted, so nothing reaches the gate's HTML, page data or metadata. Tests put sentinel values in title, description, place and ticket name and assert their absence for every non-entitled viewer.
- **Hidden everywhere else:** Explore, home, society pages and `GET /api/public/events/[eventId]` leave these events out. Ticket checkout rechecks access under the buyer lock (which revocation and refunds also take) and refuses anyone else, guests included, with `event_not_found`. Fulfilment rechecks too (`members_only_access_revoked`): a membership revoked during a hold sends the paid order to compensation review, while one that merely ended keeps its tickets.
- **Image:** served only to members it is open to, `private, no-store` ([[Society Profiles and Assets]]).
- **Member's view:** the full page with a "Members only" note naming their membership. The confirmation page reads the event for the buyer's own order, so a ticket holder keeps it.

## Ending a membership early

`lib/memberships/revocation.ts`, under member (User), society (Organisation) and order locks. Routes go through `staffEndRoute`: trusted origin, live permission, `reason` 8 to 500 characters and, unless staff MFA is off, a fresh authenticator `mfaCode`. A repeat answers the first result. Refusals are 409 with the reason in `details[0].reason`.

| Action | Route | Permission | Effect |
| --- | --- | --- | --- |
| Revoke | `POST .../members/[grantId]/revoke` | `memberships:manage` | Ends a running or upcoming membership now, no refund; ended ones refuse (`not_revocable`). Email `membership-ended/{grantId}`; audit `membership.revoked`. |
| Cancel a free membership | `POST .../members/[grantId]/cancel` | `orders:refund` | The free order gets `cancelledAt`, who and why, keeps its status and fulfilment, gains `free_cancelled` history; the grant is revoked with the same reason. Never a refund row. Paid ones refuse (`not_cancellable`). Same email key; audit `membership.free_cancelled`. |
| Refund a paid membership | `POST .../members/[grantId]/refund` | `orders:refund` | Also needs the order's short reference typed back (`confirmation`). A whole-order Stripe refund through `requestCommerceRefund` (audit `commerce_order.refund_requested`). The membership stays active while Stripe processes (Refund processing) and is revoked ("Refunded: {reason}") only when Stripe confirms; the buyer gets one `refund/{refundRequestId}` email. A failed refund leaves it active. 200 when confirmed, 202 while processing. |

- **Stripe-side events:** the member page and the merchandise order page show disputes and refunds made in the Stripe dashboard. An open dispute pauses refunds (and hand-over); a lost one ends the membership or leaves nothing to collect; a won one says the society kept the payment. A full outside refund ends the membership or cancels the pickup; a partial one is flagged with Mark reviewed, and Refund then takes only the rest. A paid commerce order that couldn't be fulfilled is refunded in full automatically. Rules: [[Payment Lifecycle]].

## Merchandise catalogue

`lib/merchandise/catalogue.ts`. A product (`MerchandiseProduct`) is something a society sells for pickup: name (1 to 120), description (up to 2000), up to 4 photos (`MAX_PHOTOS`) and up to 50 options (`MAX_OPTIONS`). It is `draft`, `published` or `archived`, never deleted.

- **Options** (`MerchandiseVariant`): colour and size (up to 40 characters each, either may be blank; one option leaves both blank), SKU, price, stock (`remaining`, 0 to 100,000), and display `position`. The same colour and size twice is refused. Each option has a `version` that a sale or another editor bumps; a save from a stale page is 409 and changes nothing.
- **SKUs** are unique in the society for good, including options that stopped selling, so a receipt's SKU always names one option. Up to 64 characters of letters, numbers, dots, dashes and underscores, uppercased. Blank: made from name, colour and size (`ENGSOC-HOODIE-NAVY-L`, then `-2` if taken). Why: staff never have to invent one, but stock and pickups need a stable identifier.
- **Photos:** ready `product` assets of the same society (`MerchandiseProductImage`, position 0 to 3; the first is the cover), uploaded through the shared asset route. Alt text is derived ("{product}, photo 1 of 3"). Photos count as references for cleanup and deletion and are public while the product is published.
- **Publish check** (`productReadiness`; 409 with `reason`): `photo_missing`, `no_options`, `no_stock`, `payments_unavailable` (free options in stock publish without payments), `pickup_missing` (the society profile needs `pickupPolicy`). A photo is required because clothing is bought on its look. A published product must keep a photo and an option; stock may run out and prices may change (receipts keep the price paid).
- **Removing an option:** deleted while the product has never been on sale (`firstPublishedAt` null); after that it stops selling (`archivedAt`) and keeps its SKU.
- **Archive and restore:** archiving stops sales and hides the product; Restore brings it back as a draft. Reversible, unlike plans, because products are often sold again next semester.
- **Pickup details** are one society-wide text (`Organisation.pickupPolicy`), shown with every product, the basket and receipts; it can't be cleared while products are on sale.
- **Concurrency:** User, Organisation, the product, its options in ascending id, then photo assets. Checkout locks options in the same order and never the product, so the two can't deadlock.
- **Access:** live `merchandise:manage` (owners, admins) on `/dashboard/merchandise` and `/api/orgs/[orgSlug]/merchandise`. A non-staff member or another society's slug gets 404; staff without the permission get 403. Audits `merchandise_product.created`, `merchandise_product.updated`, `merchandise_product.published`, `merchandise_product.archived`, `merchandise_product.restored`.

## Shop and basket

- **Shop:** published products of the society with their on-sale options; drafts, archived products and stopped options never show. The society page shows a Merchandise tab while a product is on sale (`hasShop`), and its Overview previews the four newest products and the soonest membership plan still to end. Cards show the cover, option summary, "From $X" when prices differ, "Only N left" at 5 or fewer (`LOW_STOCK`), and Sold out. Stock shown is after checkout holds and is advice; checkout decides under locks.
- **Product page** (`/societies/[orgSlug]/merchandise/[productId]`): gallery, colour and size radio groups (sold-out options stay visible, disabled), quantity capped at 10 and at what's left, Add to merch basket (UX spec 5.4), pickup, refund and contact details.
- **Basket** (`/societies/[orgSlug]/merchandise/basket`, `lib/merchandise/basket.ts`): one society's option ids and quantities in browser storage, never prices or names. At most 10 different options (`MAX_BASKET_LINES`) and 10 of each (`MAX_LINE_QUANTITY`); repeats merge. Adding another society's item asks to keep that basket or clear it. Every view re-quotes through `POST /api/merchandise/quote`: stopped options leave with a notice, quantities above what's left are lowered with a note, sold-out lines must be removed, and the quote `version` changes with any price, quantity or line.
- A standalone shop, not add-ons in ticket checkout, because societies sell merchandise outside events.

## Selling merchandise

`lib/merchandise/sale.ts`, the `merchandiseFamily` registered with commerce checkout ([[Payment Lifecycle]]).

- **Buyers:** a verified member account or a verified guest's checkout session. Body `selection: {items: [{variantId, quantity}], quoteVersion}`: 1 to 10 different options of one society, 1 to 10 of each, each once.
- **Checkout** (`POST /api/payments/checkout/merchandise`): under the buyer lock, then the options in ascending id, the quote refuses (409, nothing charged): `unavailable` (stopped or another society's), `sold_out`, `not_enough` (with the number left), `quote_changed` (prices or quantities moved since the reviewed version); the total must match too. Nothing is lowered at checkout. Each line records its option (`merchandiseVariantId`), name, option label and price.
- **Holds:** a paid basket holds its stock until its order's `expiresAt`, 20 minutes (`commerceHoldMinutes`), when the stale-orders job closes the Stripe page and expires the order ([[Payment Lifecycle#Holds]]). A hold is not a row: the lines of a pending Stripe order before `expiresAt` hold their units (`heldByVariant`), so paying, failing or expiring the order ends the hold. Shop, quote, checkout and fulfilment all subtract holds. A buyer (member or guest email) has one unpaid basket per society; a second checkout is 409 `purchase_in_progress` until the first is paid, cancelled or lapses (SEC-010).
- **Free cap (PAY-051):** `quote` adds the buyer's earlier free units of each option (paid baskets too; not cancelled, refunded or closed orders) and refuses past `MAX_LINE_QUANTITY` with 409 `free_limit_reached`. Members count by account, guests by email.
- **Fulfilment:** a free total completes in checkout; a paid one only from the verified webhook. Under option and order locks every line takes stock once (`remaining` down, option `version` up) or none does, with one receipt `merchandise-receipt/{orderId}` (items, total, short reference, pickup details). An option that stopped selling during a valid hold is honoured. A payment whose hold lapsed when stock has gone goes to compensation review (`sold_out`).
- **Stock edits:** saving an option with less stock than checkouts hold is refused on the field ("3 are held in checkouts right now, so stock can't go below 3.").
- A basket mixing free and paid options goes through Stripe with the free ones on the order but not on Stripe's line items.
- **Checkout page** (`/societies/[orgSlug]/merchandise/checkout`, `noindex`): re-quotes the device basket. Verified members review signed in; unverified are asked to verify; society accounts go back to the basket; anyone signed out gets the guest email step (with Sign in instead). The review shows items, pickup details, receipt address, the 20-minute hold (`commerceHoldMinutes`), refund policy and support address, then Pay $X or Confirm free order. A changed basket links back instead of paying. Refusals end with "Nothing has been charged".
- **Order page** (`/merchandise/orders/[orderId]`, `noindex`): Stripe's success and cancel URLs and free orders land here. Only the buying member, the guest checkout session that bought it, or a purchase link for it opens it; others get not found. States: You haven't paid yet, Confirming your payment, No payment taken (basket kept), We're refunding your payment, or Order confirmed (basket cleared). Payment and Pickup are separate badges, with a three-step pickup tracker.
- **Guests:** `GET /api/commerce/orders/[orderId]` and the order page answer a guest only through `canOpenGuestCommerceOrder`: a checkout session opens orders bought in that session, never another session's of the same email; a purchase session opens the one order its link names (`GuestAccessGrant.commerceOrderId`). A guest's receipt is a `guest_order_link` email whose link opens the order once, on any device, for 24 hours; Find your purchase (`/guest/recover`) sends a fresh link per paid guest merchandise order and supersedes any unused link (its queued email is cancelled). A purchase session can't buy. A guest's failed receipt isn't in the society's failed-notification requeue list.

## Pickups

`lib/merchandise/pickups.ts`. Pickup is tracked per order, not per item.

- **State:** `CommerceOrder.pickupStatus` becomes `pending` when a merchandise order is fulfilled; staff move it to `ready`, then `collected`. Orders under payment review never get one. It is separate from payment status.
- **Pickups tab** (`/dashboard/merchandise/pickups`, `merchandise:fulfil`, owners and admins; Products shows "Pickups · N to prepare"): To prepare, Ready to collect, Collected and Needs review, with counts, search by reference, name or email, and pages of 25 either way; a step returns to the same search and page. To prepare and Ready list oldest first; Collected and Needs review newest first. Needs review holds orders under compensation review and disputed orders not yet collected.
- **Mark several ready:** To prepare has a checkbox per order (`components/merchandise/batch-ready.tsx`) and "Mark N ready", which confirms with the references and marks each through `markPickupsReady` (`POST /api/orgs/[orgSlug]/merchandise/pickups`), one email per buyer; an order someone else moved is named and skipped. Mark collected stays one at a time.
- **Mark ready** and **Mark collected** buttons (`components/merchandise/pickup-action.tsx`; accessible name "Mark ready for order {reference}", so voice control finds the visible words first) call `POST /api/orgs/[orgSlug]/merchandise/pickups/[orderId]` with `pickupStepSchema` `{step, expectedVersion}`. Each is confirmed in a dialog listing the items; Hand over names the buyer to check. Under staff, society and order locks the step needs a paid order not under review, disputed, refunded or cancelled, the previous state (collected needs ready) and the current `version`. It moves the state, bumps `version`, and writes `pickup_ready` / `pickup_collected` history, audit `merchandise_order.ready` / `merchandise_order.collected` and one email `merchandise-ready/{orderId}` (with pickup details) / `merchandise-collected/{orderId}`, together. A page opened before someone else's step gets 409 naming who and when; nothing repeats.
- No undo, because the buyer was emailed. Collected needs ready first so the buyer is always told before coming to the table.

## Returns, refunds and free cancellation

`lib/merchandise/after-sale.ts`. A refund and a return are separate records: societies refund without getting items back and take items back without refunding.

- **Staff order page** (`/dashboard/merchandise/orders/[orderId]`, `merchandise:fulfil` or `orders:read`): Items (option, SKU, price, how many returned), Pickup, What happened (history with who and when), Buyer, Money (the fee only with `orders:read`) and Returns. Another society's order is not found. A finance manager arriving from Orders can refund but sees no pickup or return action.
- **Refund** (`POST .../merchandise/orders/[orderId]/refund`, `orders:refund`; `reason`, `confirmation`, `mfaCode`): the whole payment through `requestCommerceRefund`, with the same fence and Stripe checks as tickets. While Stripe processes, the order is off the Pickups tab ("Refund processing"); on confirmation a pickup not yet collected is cancelled and the buyer gets one `refund/{refundRequestId}` email ("The pickup is cancelled"). A collected order that is refunded stays in Collected. A refund never records a return or restocks. 200 when confirmed, 202 while processing. Refusals are 409 with `details[0].path` `["orderId"]`, logged as `merchandise.*`: `staffEndRoute` names the target from the operation.
- **Cancel a free order** (`POST .../merchandise/orders/[orderId]/cancel`, `orders:refund`; `reason` 8 to 500, `mfaCode`): sets `cancelledAt`, who and why, bumps `version`, writes `free_cancelled` history, audit `merchandise_order.free_cancelled` and email `merchandise-cancelled/{orderId}`. Never a refund row. A paid order refuses ("Refund a paid one instead"); a collected one refuses ("Record a return"); stock isn't put back. A repeat answers the first result.
- **Record a return** (`POST .../merchandise/orders/[orderId]/returns`, `merchandise:fulfil`, `returnSchema`): one line, quantity 1 to 10 and at most what was bought less earlier returns, `reason` 3 to 500 characters (shorter than the 8 other actions need), `restock` true or false, and a client `operationKey` (a repeat is a replay). Only a paid, fulfilled order. Under staff, society, option and order locks it writes a `MerchandiseReturn`, restocks once if asked (stock up, option `version` up), writes `return_recorded` history and audit `merchandise_order.return_recorded`. No email and no money. Restocking is a staff choice because a returned item may be worn or damaged.
- **Buyer's page:** Refunded, Refund processing or Cancelled; a collected order keeps its Collected step. Whole-order refunds only (tickets can be refunded ticket by ticket).

## Purchases and Orders tabs

- **Buyer `/purchases`** (personal menu Purchases): Tickets, Memberships and Merchandise tabs with counts; the tab is in the URL (`?family=memberships|merchandise`). Membership rows link to `/memberships/orders/[orderId]`; merchandise rows ("{first item} and N more", payment and pickup badges, "Not collected" after a refund or cancellation before pickup) link to `/merchandise/orders/[orderId]`. Each list is scoped to the member in its query (`getOwnTicketPurchases`, `getOwnCommerceOrders`) and pages newest first on the shared timestamp cursor. Checkouts that didn't complete are left out unless `?incomplete=1`. Commerce orders reuse the ticket projection (`ticketOrderProjection`, `buyerPurchaseBadge`), so Paid, Free, Refunded, Refund processing, Cancelled, Payment issue and Didn't complete mean the same everywhere.
- **Organiser `/dashboard/orders`** (`orders:read`): Tickets, Memberships and Merchandise tabs. Commerce tabs come from `listOrganisationCommerceOrders`: this society's orders only, checkouts still waiting on Stripe left out, status pills All, Paid, Free, Refunded, Payment review and Expired, filters for buyer email, plan or product (`commerceProductOptions`) and date, newest first on the shared cursor. Rows show buyer (Guest marked), reference, items or plan and term, total, payment and, for merchandise, pickup ("On hold" under review). A merchandise row opens the staff order page; a granted membership opens the member page. Both pages accept `orders:read` or their own permission (`requireManagementPage` takes a list); a finance manager gets an Orders breadcrumb. Date filters are whole days in the society's zone (`dateFilterBound`).

## Renewal reminders and expiry notices

`queueMembershipNotices` (notification worker) queues, once per grant:

- a renewal reminder `membership-renewal/{grantId}` when a running membership ends within 7 days, if it was granted at least 7 days before its end and the member has `User.renewalReminders` on (the platform's only optional email; Account settings › Notifications);
- an expiry notice `membership-expired/{grantId}` within 7 days after it ended.

Neither goes for a revoked grant (it got `membership-ended/{grantId}`), for a closed or disabled account, or when the member holds an unrevoked membership with the society that ends later. Neither extends a term; both name the society's next plan on sale that starts once this one ends, if any. Templates and delivery: [[Email Delivery Implementation]].

## Traps

- Don't store a grant's state; compute it with `grantState`.
- Don't lock a product in checkout; lock options in ascending id only.
- Free cancellation is never a refund: no `RefundRequest`, no Stripe call, order status stays `paid`.
- A new gate field must not be read before access is granted on members-only events.

## Related

[[Payment Lifecycle]] · [[Event Lifecycle]] · [[Society Profiles and Assets]] · [[Email Delivery Implementation]] · [[Audit Coverage]] · [[Database and Multi Tenancy]] · [[API Reference]] · [[Frontend and Backend Flow]]
