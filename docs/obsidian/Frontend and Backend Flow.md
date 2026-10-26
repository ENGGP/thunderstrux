---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[UI Architecture Rules]]", "[[Architecture Overview]]", "[[Authentication and Dashboard Access]]", "[[API Reference]]"]
sources: [app, lib/auth/page-access.ts, lib/auth/access.ts, lib/auth/live-session.ts, proxy.ts, components/layout/dashboard-shell.tsx, components/layout/personal-shell.tsx]
---

# Frontend and Backend Flow

**Owns:** the page map: every `app/**/page.tsx` route with its guard, main data source, main components and notable behaviour; how pages reach data; loading and error boundaries.
**Read when:** adding, moving or guarding a page, or finding which service and component a screen uses.
**Not here:** tokens, primitives, shells and copy rules ([[UI Architecture Rules]]); request/response contracts ([[API Reference]]); route guard order ([[Route Security Inventory]]); roles and the permission matrix ([[Authentication and Dashboard Access]]); metric definitions ([[Analytics and Calendar]]).

## Code

| Concern | Where |
| --- | --- |
| Management page guard | `lib/auth/page-access.ts`: `requireManagementPage(permission or permissions[], callbackPath)` |
| Legacy slug redirects | `lib/auth/page-access.ts`: `redirectLegacyOrganisationPage(orgSlug, permissions, legacyPath, target)` |
| Signed-in and role guards | `lib/auth/access.ts`: `requireAuthenticatedUser`, `requireAccountRole`, `requireCurrentOrganisationAccount` |
| Optional session (public pages) | `lib/auth/live-session.ts`: `getLiveSession` |
| Anonymous redirect for `/dashboard` and `/account` | `proxy.ts` (matcher `/dashboard/:path*`, `/account/:path*`) |
| Context and switcher choices | `lib/auth/context.ts`: `readAccountContext`, `contextChoices` |
| Shared error and missing pages | `app/error.tsx`, `app/not-found.tsx`, `app/mfa/error.tsx`, `app/(public)/societies/error.tsx` |
| Public loading states | `app/(public)/societies/loading.tsx`, `app/(public)/events/[eventId]/loading.tsx` |
| Page tests render helper | `tests/helpers/render.ts`: `renderPage` |

Route groups `(public)` and `(dashboard)` are folders only; they never appear in a URL. Page-local server components sit beside their page: `app/(dashboard)/dashboard/personal-overview.tsx`, `app/(dashboard)/dashboard/society-overview.tsx`, `app/(dashboard)/dashboard/analytics/analytics-tabs.tsx`, `app/(dashboard)/dashboard/orders/commerce-orders.tsx`, `app/(public)/societies/[orgSlug]/viewer.ts`.

## Guards

| Guard | Used by | On failure |
| --- | --- | --- |
| `requireManagementPage(p)` | every `/dashboard/*` management page | no session: `/login?callbackUrl=`; staff MFA needed: `/mfa?callbackUrl=`; no live authority or permission: concealed 404. Returns the organisation plus `contexts` for the switcher, read after both checks. An array means any one permission |
| `requireAuthenticatedUser` | personal pages | page catches `AuthenticationRequiredError` and redirects to `/login?callbackUrl=<page>`; organisation accounts are sent to `/dashboard` |
| `requireAccountRole(role)` | `/dashboard/organisations` (member), `/dashboard/create` (organisation) | wrong role: `/dashboard` |
| `getLiveSession` only | public, checkout, payment-return and guest pages | the page decides: anonymous view, login redirect, or guest session |
| none | static auth-token pages (`/reset-password`, `/change-email`, `/guest/access`, `/staff/invites/accept`) | token authority is checked by the API the form posts to |

Authority is always the live staff row for the selected context ([[Authentication and Dashboard Access]]). Navigation filtering in the shells is presentation; every page and API re-checks.

## Public pages

| Page | Data | Components | Behaviour |
| --- | --- | --- | --- |
| `/` | `getPublishedEvents({ limit: 6 })`, `discoverOrganisations` (4) | `components/events/event-card.tsx`, `components/organisations/society-card.tsx`, `components/layout/site-footer.tsx` | `force-dynamic`; listings stream behind a skeleton under the hero; society calls to action only for signed-out visitors; empty state "No upcoming events yet" |
| `/events` | `parseExploreFilters` (`lib/events/explore-filters.ts`), `getPublishedEvents`, `getExploreSocieties` | `components/ui/filter-bar.tsx`, `components/events/explore-filter-fields.tsx`, `EventCard` | Explore events. Filters `q`, `when`, `from`, `to`, `society`, `cursor`, `direction` in the URL; presets in `Australia/Brisbane` (`defaultTimeZone`); custom range at most 366 days. 20 a page, Earlier/Later events links keep filters. Invalid filter: field errors, no list read. Stale cursor: first page with "That page link has expired". Failed read: danger `Notice` "We couldn't load events", never an empty list |
| `/events/[eventId]` | `getEventForViewer` (`lib/events/public-events.ts`), `memberPricePlan` | `components/events/public-event-view.tsx`, `components/events/public-ticket-purchase.tsx`, `components/events/members-only-gate.tsx` | Anonymous allowed (T15a). Draft or wrong id: 404. Public and link-only render for everyone; members-only renders only for a member whose membership unlocks it, everyone else gets the gate (noindex). Buy box viewer is `anonymous`, `society`, `unverified` or `member`; member prices only for a verified member holding the plan; the unverified "Verify email" link returns to the checkout with the chosen ticket. Public and link-only pages carry a link preview (`openGraph`: title, date, place, description, the event image) and offer "Add to Google Calendar" and "Open in Maps" (UI-006). A cancelled event (EVT-004) keeps its page with an "Event cancelled" badge and a buy box that sells nothing. Reads only: no expiry or cleanup |
| `/fees` | `calculatePlatformFee` (`lib/stripe/fees.ts`) | `components/public/policy-page.tsx` | Worked fee examples |
| `/help`, `/privacy` | none | `PolicyPage` | Static policy pages, `force-dynamic` |
| `/societies` | `discoverOrganisations` (`lib/organisations/discovery.ts`) | `SocietyCard` | Literal name/slug search: `q` up to 120, default 25, max 50, forward name/id cursor. Bad input: warning `Notice` |
| `/societies/[orgSlug]` | `publicOrganisation`, `membershipOffers`, `hasShop`, `societyViewer` | `components/organisations/society-header.tsx`, `components/organisations/society-join-card.tsx`, `EventCard` | Public-safe profile and up to 50 upcoming published events. Join control from the caller's own state (anonymous, verify, available, joined, organisation); never auto-joins. Memberships and Merchandise tabs show only when there is something to show |
| `/societies/[orgSlug]/memberships` | `membershipOffers`, `hasShop`, `societyViewer` | `SocietyHeader`, `SocietyJoinCard` | Offers with the viewer's standing; buy links go to the review page (sign-in link when anonymous; society accounts are told to use a member account; unverified see a verify notice) |
| `/societies/[orgSlug]/memberships/[planId]/checkout` | `membershipOffer` | `components/layout/checkout-shell.tsx`, `components/memberships/membership-checkout-action.tsx`, `components/purchases/money-summary.tsx` | Requires a session (else login); non-members back to the list; offer not on sale: back to the list. Unverified: verify notice instead of the action |
| `/societies/[orgSlug]/merchandise` | `shopProducts`, `membershipOffers` | `components/merchandise/shop.tsx`, `SocietyHeader` | Product grid; basket link when products exist |
| `/societies/[orgSlug]/merchandise/[productId]` | `shopProduct` | `components/merchandise/shop.tsx` | Product page with pickup details |
| `/societies/[orgSlug]/merchandise/basket` | `publicOrganisation` | `BasketView` (`components/merchandise/shop.tsx`) | Basket kept on the device and re-quoted by the server on every view |
| `/societies/[orgSlug]/merchandise/checkout` | `readGuestSession`, `publicOrganisation` | `components/merchandise/checkout.tsx` | Members buy signed in; others confirm an email and buy as a guest. Society accounts: back to basket. Unverified member: verify notice. noindex |

`/organisations` and `/organisations/[orgSlug]` are permanent redirects to `/societies` (`next.config.ts`).

## Ticket checkout and payment return

| Page | Guard and data | Behaviour |
| --- | --- | --- |
| `/events/[eventId]/checkout` | `getLiveSession`, guest cookie (`readGuestSession`); `getEventForViewer`, `priceForViewer` | One review page for every ticket purchase (T13), `?ticketTypeId=&quantity=&guest=`. Anonymous without a checkout guest session and without `guest=1`: `/login?callbackUrl=` back here. Society account, gated event, unknown type or quantity outside 1 to `maxTicketsPerOrder`: back to the event. `guest=1` first shows `components/guest/guest-email-form.tsx`. Unverified member: "Verify your email to continue". Action is `components/purchases/checkout-action.tsx` (`POST /api/payments/checkout/event`); refusal screens are listed in [[UI Architecture Rules#Checkout state screens]] |
| `/events/[eventId]/checkout/confirmed` | session required (else login); `getMemberTicketOrder`, `getBookedEventDetail` | Free registration or a completed polled attempt: the buyer's own order for that event, ticket numbers, View my tickets. Not theirs: 404 |
| `/success` | `getLiveSession`, `getOwnOrderForCheckoutSession` | Never marks anything paid. Outside production only, a `session_id` whose Stripe Session is paid runs `reconcileCompletedCheckoutSessionWithSideEffects` (`source: "dev_success_fallback"`) for missing local webhook forwarding. Shows the buyer's own order state: "Confirming your payment" with `components/purchases/payment-status-poller.tsx` (`GET /api/purchases/tickets/[orderId]/status` every 3 s, 20 checks, then "Still confirming"), "You're going" once fulfilled (says emailed only after `ticketEmailSentAt`), "This checkout didn't complete". No order or not theirs: "Checking payment status" with Go to Purchases |
| `/cancel` | `getTicketPurchaseStatus`, `mayOpenTicketPurchase`, `pendingCheckoutState` | `?order=`. Names the order only to the member or guest session that bought it. While Stripe's page is open: "You haven't paid yet" with Return to payment and Cancel order (`components/purchases/unpaid-order-actions.tsx`, `POST /api/purchases/tickets/[orderId]/cancel`). Stripe has the payment: "Your order went through". Otherwise "No payment taken" |

Stripe return URLs (`lib/payments/checkout-creation.ts`, `lib/commerce/checkout.ts`): a member's ticket checkout returns to `/success?session_id=`, a guest's to `/guest/orders/[orderId]`, and a cancelled one to `/cancel?order=`. Membership and merchandise checkouts return to `/memberships/orders/[orderId]` or `/merchandise/orders/[orderId]`, with `?left=1` when the buyer left Stripe.

## Buyer pages (personal shell)

All use `requireAuthenticatedUser`; anonymous goes to `/login?callbackUrl=`, organisation accounts to `/dashboard`. All are inside `components/layout/personal-shell.tsx`.

| Page | Data | Behaviour |
| --- | --- | --- |
| `/tickets` | `getWalletTickets(userId, view)` (`lib/purchases/ticket-purchases.ts`) | Tabs Upcoming, Past, Not valid (`?view=`). One `components/tickets/ticket-face.tsx` per ticket, grouped by event; first 100 tickets, then "Older ones are in Purchases". Empty state per tab |
| `/purchases` | `getOwnTicketPurchases`, `getOwnCommerceOrders`, `ownPurchaseCounts` | Family tabs Tickets, Memberships, Merchandise (`?family=`) with counts; cursor pages (`limit`, `cursor`, `direction`); bad pagination: first page with a warning |
| `/purchases/tickets/[orderId]` | `getOwnTicketPurchase`, `pendingCheckoutState` | Not the buyer's: 404. Unpaid order asks Stripe: Waiting for payment (Return to payment, Cancel order), Confirming payment (poller), Didn't complete. Ticket faces, buyer-safe history (`components/ui/audit-timeline.tsx`). A free registration before the event offers "Cancel my registration" (`components/purchases/release-registration.tsx`, EVT-005). noindex |
| `/memberships` | `myMemberships(userId, view)` (`lib/memberships/offers.ts`) | Tabs Active, Upcoming, Expired, Revoked with counts; "Memberships don't renew automatically" notice on Active and Upcoming; renew links |
| `/memberships/orders/[orderId]` | session required (else login); `ownMembershipOrder`, `grantState`, `pendingCheckoutState` | Membership order outcome in `CheckoutShell`; pending polls `/api/commerce/orders/[orderId]`; unpaid offers Return to payment and Cancel (`POST /api/commerce/orders/[orderId]/cancel`); compensation review explained. noindex |
| `/merchandise/orders/[orderId]` | member session or guest session that can open it (`canOpenGuestCommerceOrder`); `getOwnCommerceOrder` | Same states as the membership order page plus pickup progress. Neither session: login redirect. noindex |

## Guest pages

| Page | Behaviour |
| --- | --- |
| `/guest/access` | Emailed link lands here; opening it does nothing, Continue posts the token (`components/guest/guest-access-form.tsx`). A used or expired link leads with "Find your purchase" (`/guest/recover`), because buyers tap their order link again at the door (DEF-054). noindex, no referrer |
| `/guest/recover` | Find your purchase (`GuestEmailForm` to `POST /api/guest/recover`); the answer never says whether the address has orders |
| `/guest/orders/[orderId]` | Opens only with the guest session that bought it or that its link started (`canOpenGuestOrder`, `getGuestOrder`); every other case shows the same "Open your order from your email" page, so an id alone reveals nothing. Shows tickets, unpaid-order actions, "Cancel my registration" for a free registration before the event, and account standing via `components/guest/guest-claim.tsx` (Add to your account, already in an account, different email, verify first) |

## Account and authentication pages

| Page | Guard and data | Behaviour |
| --- | --- | --- |
| `/login` | `getLiveSession` | Signed in: straight to the safe `callbackUrl` (`safeReturnPath`). `components/auth/credentials-login-form.tsx` |
| `/signup` | `getLiveSession` | `?for=society` preselects the society account. `components/auth/signup-form.tsx` to `POST /api/auth/signup` |
| `/verify-email` | `getLiveSession` | `components/auth/verification-form.tsx`; confirming needs an explicit POST with the password, then signs in with it and returns to the link's path |
| `/forgot-password`, `/reset-password` | none | `components/auth/password-recovery-form.tsx` (request, confirm); reset signs out all devices |
| `/change-email` | none | `components/auth/email-change-confirm-form.tsx`; opening the page changes nothing |
| `/staff/invites/accept` | none | `components/auth/staff-invite-accept-form.tsx` to `POST /api/staff/invites/accept` |
| `/mfa` | session required (else login); `getStaffMfaStatus`; `MfaInputError` goes to `/dashboard` | Staff authenticator setup and verification (`components/auth/staff-mfa-form.tsx`), returns to a safe `callbackUrl`. `app/mfa/error.tsx` says the service is unavailable |
| `/account/settings` | `proxy.ts`; `requireAuthenticatedUser`, `readAccountSettings`, `readAccountClosureEligibility`, `getStaffMfaStatus` | Personal shell. Sections: Profile (members), Password and security, Email address, Notifications (members, `PATCH /api/me/notification-preferences`), Close account. Authenticator row only for people who could use it (same eligibility as `/mfa`). Closure blockers in a warning notice. Stale session: login |

## Dashboard: overview and societies

| Page | Guard | Data | Behaviour |
| --- | --- | --- | --- |
| `/dashboard` | `proxy.ts`, `requireAuthenticatedUser`, `readAccountContext`; with a selected context `requireCurrentOrganisationAccount` | Personal: `PersonalOverview` (`getWalletTickets`, `getOwnTicketPurchases`, `getOwnCommerceOrders`, `myMemberships`, `upcomingEventCounts`, `readMemberProfile`). Society: `SocietyOverview` (`getOrganisationOverview`, `listDashboardEvents`, `societySales`, `ticketMetrics`) or `DoorOverview` (`getDoorDay`) for `check_in_staff` | Members start personal, staff included; the switcher enters a society. Selected context: MFA needed goes to `/mfa`; lost access goes to `/dashboard/create`. Organisation account with no staff society and no bootstrap: `/dashboard/create`; otherwise "Choose a staff organisation". Overview data streams behind a skeleton after the guards. Section content: [[UI Architecture Rules#Overview content]] |
| `/dashboard/organisations` | `requireAccountRole("member")` | `getAccessibleOrganisationsForCurrentAccount` | Personal shell. Joined list (`components/organisations/member-organisations-list.tsx`: View society, View events, Leave society with a confirm) and search (`components/organisations/organisation-search.tsx` to `GET /api/orgs/search`, Join to `POST /api/orgs/[orgSlug]/join`). Joining never grants management; leaving keeps staff, purchases and paid memberships |
| `/dashboard/create` | `requireAccountRole("organisation")`; existing organisation goes to `/dashboard` | none | Auth shell; `components/organisations/create-organisation-form.tsx` posts the name to `POST /api/orgs`, then opens `/dashboard/settings/profile` |

## Dashboard: events

| Page | Guard | Data | Behaviour |
| --- | --- | --- | --- |
| `/dashboard/events` | `requireManagementPage("events:read")` | `listDashboardEvents(organisationId, { view, query, publishedOnly, includeSales })` (`lib/events/event-lifecycle.ts`) | Views Upcoming (default, not yet ended), Drafts, Past, All with counts; `?view=`, `?q=` (cut to 100). At most 100 rows a view, says so when more. Sold and left only with `analytics:read`; actions (`components/events/event-actions.tsx`) only with `events:manage`. `check_in_staff`: published only, no Drafts view, links open Attendees. Table from `md`, cards below. List streams behind a skeleton |
| `/dashboard/events/new` | `requireManagementPage("events:manage")` | `readTimeZone`, `readChargeReadiness`, `entitlementOnSale` | `components/events/create-event-form.tsx` (`organisationId`, `orgSlug`, zone, charge readiness, member-price and members-only availability); `?date=` preselects the start day (from Calendar) |
| `/dashboard/events/[eventId]` | `requireManagementPage("analytics:read")` | `getDashboardEvent`, `eventTicketTypeMetrics`, `ticketAttendance`, `eventSalesDays` (`lib/analytics/metrics.ts`) | Summary tab of `EventWorkspaceHeader`. Tiles: Tickets sold, Tickets left, Capacity (`occupancy` of `capacity`, issued plus live holds) when set, Checked in, Net sales (only with `orders:read`). Draft: readiness checklist first. Ticket performance table; Sales over time in the society zone behind a skeleton. Foreign or missing event: 404 decided before streaming |
| `/dashboard/events/[eventId]/tickets` | `requireManagementPage("tickets:check_in")` | `getDashboardEvent`, `getOrganisationEventTickets` | Attendees tab: `components/tickets/check-in-console.tsx` ([[Ticket Check-in Implementation]]). Bad pagination params: redirect to the first page |
| `/dashboard/events/[eventId]/edit` | `requireManagementPage("events:manage")` | `getDashboardEvent`, `getOrganisationEventForEditing`, `readChargeReadiness`, `entitlementOnSale` | `CreateEventForm` in edit mode; a cancelled event shows a notice instead of the form; published event shows a notice that changes go live on save; draft shows the readiness checklist beside the form. 404 for a foreign event |
| `/dashboard/events/[eventId]/preview` | `requireManagementPage("events:manage")` | `getEventPreviewDetail` | Draft preview through `PublicEventView` under a "Draft preview" band. Published event: redirect to `/events/[eventId]`; missing: 404 |

Every event page shares `EventWorkspaceHeader` (`components/events/event-tabs.tsx`); its tabs are in [[UI Architecture Rules#Event workspace]]. Event rules: [[Event Lifecycle]].

## Dashboard: orders

| Page | Guard | Data | Behaviour |
| --- | --- | --- | --- |
| `/dashboard/orders` | `requireManagementPage("orders:read")` | Tickets: `getGroupedOrganisationOrdersWithContext` (`lib/orders/grouped-orders.ts`), `listEventOptions`, `getDashboardEvent`. Memberships and merchandise: `listOrganisationCommerceOrders` (`lib/commerce/orders.ts`) via `commerce-orders.tsx` | Family tabs Tickets (default), Memberships, Merchandise (`?family=`). Tickets: status pills All, Paid, Expired, Failed (`orderStatusFilters`); "Show system orders (pending checkouts)" adds Pending (`includeSystem=true`). Filters buyer email (`search`), Event, `startDate`, `endDate`; cursor pages. The read groups by event; the page flattens one table newest first. `?eventId=` of this society swaps the header for `EventWorkspaceHeader` (Orders tab, stays on tickets); a foreign event id gives an empty list. Commerce: pills All, Paid, Free, Refunded, Payment review, Expired; plan or product filter. Date filters are whole days in the society's zone on both (`dateFilterBound`), and order times show in that zone too (DEF-057). Results stream behind a skeleton. Pending rows have no link |
| `/dashboard/orders/[orderId]` | `requireManagementPage("orders:read")` | `getOrganisationOrderDetail`, `getOrganisationOrderLifecycle` (`?historyCursor=`, `?historyDirection=`) | Scoped by `Order.event.organisationId`; foreign or missing: 404. Title `Order` plus the last six id characters. Dates in the society's zone. Actions in `components/orders/order-detail-actions.tsx` (refund, cancel free registration, record outside refund, verify compensation refund, resend) and `components/orders/order-review-actions.tsx`; refund needs `orders:refund`. One `Order history` section |

## Dashboard: memberships and merchandise

| Page | Guard | Data | Behaviour |
| --- | --- | --- | --- |
| `/dashboard/memberships` | `requireManagementPage("memberships:manage")` | `listPlans` (`lib/memberships/plans.ts`) | Plans and Members tabs; table from 768px; Edit for drafts, Details otherwise; empty state "No membership plans yet" |
| `/dashboard/memberships/new` | `requireManagementPage("memberships:manage")` | `readTimeZone` | `components/memberships/plan-form.tsx` |
| `/dashboard/memberships/[planId]` | `requireManagementPage("memberships:manage")` | `readPlan` | Form plus aside: `components/memberships/plan-checklist.tsx`, `components/memberships/plan-actions.tsx`, offer preview. Archived is read-only; a sold plan locks all but the description |
| `/dashboard/memberships/members` | `requireManagementPage("members:read")` | `listRoster`, `listFreeJoins` (`lib/memberships/roster.ts`) | Pills Active, Upcoming, Expired, Revoked, then Free joins, with counts; `?view=`, `?q=` (100), `?cursor=` |
| `/dashboard/memberships/members/[grantId]` | `requireManagementPage(["members:read", "orders:read"])` | `readMembership`, `latestCommerceRefundRequest` | Breadcrumb is Memberships > Members with `members:read`, else Orders (finance staff can't open the roster). `components/memberships/membership-actions.tsx`: refund (`orders:refund`), revoke (`memberships:manage`), cancel free; refund and dispute notices via `components/commerce/stripe-review-notice.tsx` |
| `/dashboard/merchandise` | `requireManagementPage("merchandise:manage")` | `listProducts`, `toPrepareCount` | Products and Pickups tabs (Pickups shows "N to prepare"); empty state "No products yet" |
| `/dashboard/merchandise/new`, `/dashboard/merchandise/[productId]` | `requireManagementPage("merchandise:manage")` | `readProfile`; `readProduct` | `components/merchandise/product-form.tsx`, `components/merchandise/product-actions.tsx` |
| `/dashboard/merchandise/pickups` | `requireManagementPage("merchandise:fulfil")` | `listPickups`, `pickupResult` | Stage pills To prepare (default), Ready to collect, Collected, Needs review; `?stage=`, `?q=`, `?cursor=`, `?done=` (success notice after a step). Products tab only with `merchandise:manage`. `components/merchandise/pickup-action.tsx` |
| `/dashboard/merchandise/orders/[orderId]` | `requireManagementPage(["merchandise:fulfil", "orders:read"])` | `staffMerchandiseOrder`, `pickupSettings` | Breadcrumb is Merchandise > Pickups with `merchandise:fulfil`, else Orders. Items, pickup and money cards; `components/merchandise/order-actions.tsx` (refund, cancel free, returns); finance sees money actions, fulfilment staff see pickup steps |

Product rules: [[Memberships and Merchandise]].

## Dashboard: insights

| Page | Guard | Data | Behaviour |
| --- | --- | --- | --- |
| `/dashboard/calendar` | `requireManagementPage("events:read")` | `readCalendar` (`lib/events/calendar.ts`) | Month (default), Week, Agenda (`?view=`, `?date=`); bad date opens today with a warning; more than `calendarEventCap` events: warning; `components/calendar/calendar-views.tsx` |
| `/dashboard/analytics` | `requireManagementPage("analytics:read")` | `analyticsRange` (`lib/analytics/range.ts`), tabs in `analytics-tabs.tsx` (`lib/analytics/metrics.ts`) | Tabs Tickets, Memberships, Merchandise, Engagement; Memberships, Merchandise and money need `orders:read`. `?tab=`, `?from=`, `?to=`, `?bucket=`, `?eventId=` (this society's events only). Bad range: danger notice "Pick a shorter range", default range used |
| `/dashboard/history` | `requireManagementPage("audit:read")` | `readHistory`, `historyPeople`, `hasHistory` (`lib/audit/history.ts`) | Filters What, Who, From, To (society-zone days); `?cursor=` pages; stale cursor restarts from newest with a notice. States: Nothing recorded yet, No matches. Content rules: [[Audit Coverage]] |

## Dashboard: settings

| Page | Guard | Data | Behaviour |
| --- | --- | --- | --- |
| `/dashboard/settings` | `requireManagementPage("stripe:manage")` | client: `components/settings/stripe-connect-settings.tsx` | Payments. The card resolves the society through `GET /api/orgs/[orgSlug]` and reads `GET /api/stripe/connect/status`; actions call `/api/stripe/connect/onboard`, `/continue`, `/dashboard`, `/disconnect` (authenticator code via `/api/me/mfa/status` when MFA is on). UI rules: [[UI Architecture Rules#Stripe settings]]; states: [[Stripe Payments and Connect#Connect account states]] |
| `/dashboard/settings/profile` | `requireManagementPage("organisation:settings")` | `readProfile`; `listOrganisationStaff` only with `staff:manage`; `readChargeReadiness` only with `stripe:manage` | Four-step resumable editor (`components/settings/society-profile.tsx`); time zone list computed on the server; Finish checklist shows only facts the caller may see. Rules: [[Society Profiles and Assets]] |
| `/dashboard/settings/staff` | `requireManagementPage("staff:manage")` | `listOrganisationStaff`, `listPastStaffInvites`; `listHandoverTargets` for owners | `components/settings/staff-management.tsx`; owners also get `components/settings/staff-handover.tsx` |
| `/dashboard/notifications` | `requireManagementPage("orders:email_resend")` | `listFailedBusinessNotifications` (`lib/email/notification-outbox.ts`) | Email delivery: failed society emails, `components/settings/failed-notifications.tsx` (Send again with a review reason, `POST /api/notifications/[jobId]/requeue`); bad cursor: redirect to the first page. Account-security mail never appears |

## Legacy slug routes

`app/(dashboard)/dashboard/[orgSlug]/layout.tsx` is a pass-through. Each page calls `redirectLegacyOrganisationPage`: unknown slug or no live authority is a 404; MFA needed goes to `/mfa`; a slug that isn't the selected context goes to `/dashboard`; otherwise it redirects to the slugless page. Links are only ever generated slugless.

| Legacy page | Permissions (any) | Target |
| --- | --- | --- |
| `/dashboard/[orgSlug]` | `events:manage`, `orders:read`, `tickets:check_in`, `stripe:manage`, `staff:manage` | `/dashboard` |
| `/dashboard/[orgSlug]/events`, `/dashboard/[orgSlug]/events/new` | `events:manage` | `/dashboard/events`, `/dashboard/events/new` |
| `/dashboard/[orgSlug]/events/[eventId]/edit` | `events:manage` | `/dashboard/events/[eventId]/edit` |
| `/dashboard/[orgSlug]/orders` | `orders:read` | `/dashboard/orders` |
| `/dashboard/[orgSlug]/settings` | `stripe:manage` | `/dashboard/settings` |

## How pages reach data

- **Server pages call `lib/*` services directly**, never their own `/api` routes and never Prisma (`tests/integration/domain-service-boundaries.test.ts`). They pass the organisation id the guard returned.
- **Client components call the API for every change** through `fetchJson` or `fetchWithCsrf` (`lib/client/api.ts`), then `router.refresh()` to re-read on the server. Main callers: event form and actions (`/api/events`), check-in console (`/api/events/[eventId]/tickets`, `/api/tickets/[ticketId]/check-in`), checkout actions (`/api/payments/checkout/*`, attempt polling via `waitForAttempt` in `lib/client/checkout.ts`), order actions (`/api/orders/[orderId]/*`), memberships and merchandise forms and actions (`/api/orgs/[orgSlug]/memberships/*`, `/api/orgs/[orgSlug]/merchandise/*`), staff and profile settings (`/api/orgs/[orgSlug]/staff/*`, `/profile`, `/assets`), account forms (`/api/me/*`), guest forms (`/api/guest/*`), join and leave, context switcher (`POST /api/me/context`), Stripe settings. Contracts: [[API Reference]].
- **Reads in the browser** are rare: the check-in console search, the payment status poller, the merchandise basket quote (`POST /api/merchandise/quote`), society search, and the Stripe status card.
- **Loading:** a page decides every redirect and 404 above its `<Suspense>` boundary, then streams slow reads behind a skeleton (events list, overviews, orders, analytics, calendar, history, plans, roster, products, pickups, Explore, home). There is no root or dashboard `loading.tsx`: it would answer 200 where a page redirects or conceals a 404. Only `/societies` and `/events/[eventId]` have public `loading.tsx` files.
- **Errors:** `app/error.tsx` says nothing about the cause; `app/not-found.tsx` is also what a foreign tenant resource renders and must not hint that it exists.

## Traps

- Put the guard and any 404 or redirect decision before `<Suspense>`; inside it, the status is already 200.
- Don't add a `loading.tsx` under `app/` or `app/(dashboard)/`; see Loading above.
- Pages render their shell after the guard. Don't move a shell into a route-group layout: layouts don't re-render when authority changes.
- Generate only slugless `/dashboard/*` links. The `[orgSlug]` pages are redirects.
- Integration tests render pages with `renderPage`, which waits for every boundary; `renderToStaticMarkup` prints only the fallbacks.
- Scope organiser order and ticket reads by the event's organisation, never `Order.organisationId` or a client-sent id.

## Related

[[UI Architecture Rules]] · [[Architecture Overview]] · [[Authentication and Dashboard Access]] · [[API Reference]] · [[Route Security Inventory]] · [[Event Lifecycle]] · [[Payment Lifecycle]] · [[Ticket Check-in Implementation]] · [[Memberships and Merchandise]] · [[Analytics and Calendar]]
