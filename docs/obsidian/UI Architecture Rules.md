---
status: living
last-reviewed: 2026-10-27
owner: engineering
related: ["[[Frontend and Backend Flow]]", "[[Accessibility Review]]", "[[Authentication and Dashboard Access]]"]
sources: [app/globals.css, app/layout.tsx, components/ui, components/layout/navbar.tsx, components/layout/site-footer.tsx, components/layout/dashboard-shell.tsx, components/layout/personal-shell.tsx, components/events/event-tabs.tsx, components/settings/stripe-connect-settings.tsx, .design-sync/config.json]
---

# UI Architecture Rules

**Owns:** design tokens and fonts, the `components/ui/*` primitives, the shells and global header and footer, shared UI patterns and copy rules, the Stripe settings card, and the design-sync setup.
**Read when:** building or restyling any screen, adding a primitive or status, or changing navigation.
**Not here:** which page lives where, its guard and data ([[Frontend and Backend Flow]]); what is scanned for accessibility ([[Accessibility Review]]); target presentation ([[THUNDERSTRUX_COMPLETE_VISUAL_DESIGN_SPEC|Visual Design]]); Connect states and their meaning ([[Stripe Payments and Connect]]).

## Code

| Concern | Where |
| --- | --- |
| Tokens and semantic utilities | `app/globals.css` (the only token source) |
| Fonts, skip link, header offset, verify banner | `app/layout.tsx` |
| Primitives | `components/ui/` |
| Shells | `components/layout/auth-shell.tsx`, `components/layout/checkout-shell.tsx`, `components/layout/personal-shell.tsx`, `components/layout/dashboard-shell.tsx` |
| Page title | `components/layout/page-header.tsx`: `PageHeader` |
| Header, footer | `components/layout/navbar.tsx`, `components/layout/site-footer.tsx` |
| Context switcher | `components/layout/context-selector.tsx` |
| Event workspace | `components/events/event-tabs.tsx`, `components/events/event-actions.tsx` |
| Design sync | `.design-sync/config.json`, `.design-sync/NOTES.md`, `.design-sync/conventions.md` |

## Tokens and fonts

- `:root` defines the `--ts-*` properties: ink, brand, paper and surface colours, borders, focus, and five status roles. Success (jade), warning (ochre), danger (crimson), info (brand lilac) and neutral each have a text colour, a `-bg` wash, a `-border` hairline and an `-icon` mark. Every text colour is at least 6:1 and every icon colour at least 3:1 on its own wash.
- `@theme inline` exposes them as semantic utilities: `bg-paper`, `bg-surface`, `text-ink`, `text-ink-soft`, `bg-brand`, `border-line`, `border-line-strong`, `text-danger`, `bg-warning-bg`, `shadow-float`, and so on.
- Type: `text-caption` (13px, meta lines and counts) and `text-ui` (15px, dense body) sit between the scale's steps. Use them, not `text-[13px]`/`text-[15px]`; only display sizes (17px and up) keep arbitrary values.
- Corners: `rounded-tag` (6px), `rounded-control` (9px), `rounded-card` (14px), `rounded-feature` (20px); not `rounded-md`/`-lg`/`-xl`.
- Widths: `max-w-auth`, `max-w-read`, `max-w-checkout`, `max-w-personal`, `max-w-page`, `max-w-admin` (values in `app/globals.css`).
- No raw palette classes (`bg-neutral-900`, `text-purple-600`) and no hex colours in components.
- Bare `border` draws the hairline token; Tailwind's `currentColor` default is overridden in the base layer.
- The focus ring is a 2px `--ts-focus` outline outside any layer, so `outline-none` cannot remove it. `prefers-reduced-motion` shortens every transition and animation.
- Motion tokens sit in their own `@theme` block: `ease-out` is the strong curve `cubic-bezier(0.23, 1, 0.32, 1)`, and `animate-pop-in` (160ms), `animate-dialog-in` (200ms), `animate-fade-in` (200ms) and `animate-sheet-up` (240ms) are entry keyframes. Where they are used: [[#Motion]].
- `app/layout.tsx` loads DM Sans (UI) and Space Grotesk (`h1`, `h2`, `font-display`) through `next/font`; they are downloaded at build time and served by the app.
- No dark mode. No icon library: `components/ui/icon.tsx` holds the outline icons, always decorative beside text.

## Primitives

`components/ui/` holds the shared primitives. Extend them rather than writing class strings in pages.

| File | What | Rules |
| --- | --- | --- |
| `button.tsx` | `Button`, `buttonClasses()` for links styled as buttons | Variants `primary`, `secondary`, `tertiary`, `danger`; sizes `sm` (`h-9`, 36px), `md` (`h-11`, 44px, default), `lg` (`h-12`, 48px) |
| `input.tsx` | `Field`, `TextInput`, `TextArea`, `Select`, `MoneyInput` | The `<label>` holds only the label text; hint and error sit outside and are tied with `aria-describedby`; an error sets `aria-invalid`. `MoneyInput` has a `$` prefix; callers turn text into cents with `parseMoneyInput` (`lib/format.ts`) |
| `date-field.tsx` | `DateField`, `DateTimeField` | Replace every `type="date"`, `type="time"` and `type="datetime-local"`. `DateField` accepts "22 Oct 2026", "22/10/2026" or `2026-10-22` and has a Monday-first calendar (today ringed, chosen day filled, outside `min`/`max` disabled). Keyboard: arrows by day and week, Home/End to week ends, PageUp/PageDown by month (Shift: year), Enter picks, Escape closes. With `name` a hidden input submits `YYYY-MM-DD` for GET filter forms; without it, it is controlled. `DateTimeField` adds a Time list in 15-minute steps, keeps a saved off-grid time, and emits zone-free `YYYY-MM-DDTHH:MM` that `zonedCandidates` (`lib/zoned-time.ts`) resolves |
| `card.tsx` | `Card` | Bordered surface |
| `notice.tsx` | `Notice` | Tones `info`, `success`, `warning`, `danger`: wash, hairline, icon, toned title, ink body. `action` ends the row; `onDismiss` (client only) adds a close button. Pass `role="alert"` or `role="status"` only for the result of an action |
| `status-badge.tsx` | `StatusBadge` | The one map from a status to its word and colour (pill, dot, word). Add a status there, never in a page |
| `link-tabs.tsx` | `LinkTabs`, `tabClasses`, `tabBarClasses`, `pillClasses`, `pillBarClasses`, `Count` | URL-driven tabs and pills; see Patterns. `event-tabs.tsx` re-exports `tabClasses` and `tabBarClasses` |
| `filter-bar.tsx` | `FilterBar` | A GET form with Clear; every filter lives in the URL |
| `empty-state.tsx` | `EmptyState` | One reason and one action for an empty list |
| `responsive-table.tsx` | `ResponsiveTable` | Bordered table from 768px (a focusable region named after its content), the caller's cards below |
| `audit-timeline.tsx` | `AuditTimeline` | One history list in exactly one `<section>`, so a page has one place its history lives |
| `skeleton.tsx` | `Skeleton`, `ListSkeleton` | Only as a `<Suspense>` fallback after a page's guards; `ListSkeleton` has one screen-reader label |
| `confirm-dialog.tsx` | `ConfirmDialog` | Native `<dialog>` naming the action and its consequences; body mounted only while open; Escape cancels and never confirms, not while busy. Use instead of `window.confirm` |
| `icon.tsx` | `Icon` | Decorative outline icons |

Shared content components: `components/events/date-rail.tsx` (day and month in the society's zone), `components/events/event-card.tsx` (16:9 image when there is one, date rail, host link, one whole-card link) and `components/organisations/society-card.tsx`. Neither shows a price or count the data model does not hold. A list of `EventCard`s passes `media` when any event has an image, so every card gets the same 16:9 area.

## Shells

Each page renders its shell after its guards pass; shells are never in route-group layouts (a layout would not re-render when authority changes, and integration tests render page output directly).

- **Auth shell** (`AuthShell`): narrow column for sign-in, signup, verification, recovery, email-change confirmation, guest access, staff invitation, staff MFA, `/dashboard/create` and the payment-return fallbacks. Title, optional description, nothing else.
- **Checkout shell** (`CheckoutShell`): every purchase step. "Booking for {society}", a way back (Change tickets, Back to basket), the steps, then the content and its summary.
- **Personal shell** (`PersonalShell`): `/dashboard` in personal context, `/dashboard/organisations`, `/tickets`, `/purchases`, `/purchases/tickets/[orderId]`, `/memberships`, `/account/settings`. Navigation (labelled `Personal navigation`): Overview, My tickets, Memberships, Societies, Purchases, Account; organisation accounts see Overview and Account only. Purchases stays current on its order pages. The switcher shows only when the page passes `contexts` and the person staffs a society, with "Switch to a society you staff to manage its events." It never shows society management controls.
- **Organisation shell** (`DashboardShell`): owns organisation navigation; don't duplicate these links in pages.

| Group | Item | Route | Capability |
| --- | --- | --- | --- |
| (none) | Overview | `/dashboard` | none |
| (none) | Events | `/dashboard/events` | `events:read` |
| (none) | Calendar | `/dashboard/calendar` | `events:read` |
| (none) | Orders | `/dashboard/orders` | `orders:read` |
| Community | Memberships | `/dashboard/memberships` | `memberships:manage` |
| Community | Merchandise | `/dashboard/merchandise` | `merchandise:manage` |
| Insights | Analytics | `/dashboard/analytics` | `analytics:read` |
| Insights | History | `/dashboard/history` | `audit:read` |
| Settings | Society profile | `/dashboard/settings/profile` | `organisation:settings` |
| Settings | Staff | `/dashboard/settings/staff` | `staff:manage` |
| Settings | Payments | `/dashboard/settings` | `stripe:manage` |
| Settings | Email delivery | `/dashboard/notifications` | `orders:email_resend` |

- Filtering is presentation; every page and API enforces the same capability. An item is added only when its destination exists; empty groups are dropped.
- The longest matching route sets `aria-current="page"`, so `/dashboard/settings/staff` marks Staff, not Payments.
- The shell owns the page container (`max-w-admin`, page gap); pages narrow a form with their own `max-w-*` wrapper.
- From `lg` the navigation is a 244px deep-plum column whose contents stick below the header, so the verify banner pushes it down. Below `lg` the column holds `Current society`, the name and the `Society menu` disclosure. Nav rows are 36px from `lg` so the column fits an 800px-tall screen; it scrolls only on shorter screens.
- The staff authenticator (`/mfa`) is not in this navigation: it is reached from Account settings and automatically when a page needs verification.
- **Context switcher** (`ContextSelector`, labelled `Workspace`): options are society names with `Your role: …` beneath. Choices come from the server with the page (`requireManagementPage` returns them after both guards; `/dashboard` passes its own); the browser never fetches them. Selecting posts `POST /api/me/context`, a signed login-bound preference that carries no authority. Exactly one switcher per page.

## Global header and footer

- `Navbar` is rendered once by `app/layout.tsx`: fixed, `h-[60px] md:h-[72px]` including its border; the layout offsets content by the same amounts.
- It reads only the session; it never shows a society, role or email.
- Links: `Thunderstrux` (`/`), `Explore events`, `Explore societies`; signed in, `My tickets` (members), `Dashboard`, `Account` and a `Sign out` button; signed out, `Sign in` and `Create a society` (`/signup?for=society`). Home shows society calls to action only to signed-out visitors, because a society needs its own account.
- Below `md` a native `Menu` disclosure holds the links; Sign out or Sign in stays outside it.
- The current section is ink with a 3px brand rule on the header's bottom edge.
- On any `/checkout` path the header drops its browsing links and Menu (visual spec 3.3).
- The header owns the names `Explore events` and `Explore societies`; other links to those places use other words (`Events`, `Find a society`, `Browse societies`) so link names stay unique.
- `SiteFooter` is rendered by `app/(public)/layout.tsx` (which does nothing else: no auth, context or data) and by the home page. Links: Events, Societies, Fees, Help, Privacy. Terms waits for legal drafting (LEGAL-001). The page area is a column at least one screen tall and the footer takes `mt-auto`; a page's centred `main` needs `w-full` beside `mx-auto`.
- **Verify-email banner** (`components/layout/verify-email-banner.tsx`): under the header for a signed-in, unverified user. Close sets `thunderstrux-verify-dismissed` (`lib/auth/verify-banner.ts`) to the user id for seven days. Dismissing changes nothing: `requireVerifiedUser` and `lockVerifiedAccount` still refuse purchases, joins, society creation and invitation acceptance, and those screens prompt in place. A labelled region, not a live region; links to `/verify-email`.

## Patterns

- **Headings:** each page has one `h1` (`PageHeader` or its own), sections are `h2`. Every page sets `metadata` (`{title} · Thunderstrux`); public and link-only events and society pages use their own name, members-only pages stay generic.
- **Main landmark:** every page's `<main id="main" tabIndex={-1}>` is the Skip to content target.
- **Tabs vs pills:** sections are link tabs (`tabClasses`, `LinkTabs`); the bar scrolls sideways on narrow screens instead of wrapping. Status filters inside a tab are pills (`pillClasses`: Orders, Pickups, Members), never a second row of tabs. Every count on a tab or pill uses `Count`.
- **Filters:** `FilterBar` GET forms; every filter, view and cursor is in the URL. A stale cursor falls back to the first page with a warning notice, never an error.
- **Empty vs failed:** an empty list is an `EmptyState` (one reason, one action; "No matches" offers Clear filters). A failure or denied access is a `Notice`, never "nothing here".
- **Statuses:** always `StatusBadge`. Draft, expired, revoked, unused, Sales closed and Sold out are neutral; Sales open, Paid and Free are success; Processing and Payment review (charged, not fulfilled) are warnings; joined and upcoming use the brand accent. Orders show `ticketOrderProjection` (`lib/purchases/projection.ts`). Pickup is always a separate badge from payment.
- **Lists:** `ResponsiveTable` for dashboard lists (orders, commerce orders, Pickups, members); page grids use `grid-cols-1` so wide content scrolls inside its card.
- **Money copy:** amounts through `formatMoney`/`formatPrice` (`lib/format.ts`, AUD; `formatPrice` says "Free" for zero). Buy boxes say "Prices in AUD". Never claim a payment succeeded from the browser; only the signed webhook establishes it. The fee line under a paid price: "For one ticket you receive $X after the Thunderstrux fee (3.75% plus $0.89 a ticket), which includes card processing" (computed with `calculatePlatformFee`, `lib/stripe/fees.ts`), plus a set-up-payments link while the society cannot take payments; a free price says "Free. No fee and no payment setup needed."
- **Dates:** in the society's IANA zone (`formatDateTime`, `zoneCity`), default `Australia/Brisbane`; name the zone where times are listed. Order references are the last six id characters, upper case (`orderReference`).
- **Confirmations:** destructive or irreversible actions use `ConfirmDialog` naming what happens and what it does not undo; results report through a `Notice` with a live role.
- **Concurrency:** a version conflict (409) keeps the user's edits and offers a reload (profile also offers `Save my version`); unsaved-change guards ask before leaving.

## Motion

Motion shows where something came from or confirms that a change happened, and only after the server has answered (visual spec 2.4). Only `opacity`, `scale` and `translate` animate. **Entries animate; exits are instant:** `ConfirmDialog` unmounts its body on close, a chosen menu action shouldn't wait on a fade, and the phone buy bar hands over to the box's own button.

| Where | Motion |
| --- | --- |
| `buttonClasses()` and the check-in button | Press: scale to 97% over 150ms (`active:not-disabled:scale-97`) |
| `EventActions` More menu, navbar `Menu`, `DateField` calendar | `animate-pop-in`, from the trigger (`placeMenu` sets the origin above or below) |
| `ConfirmDialog` | `animate-dialog-in` from the centre; the backdrop fades in |
| `Notice` with a `role` | `animate-fade-in`; notices without a role are guidance and stay still |
| Check-in card | Its colours cross-fade over 150ms when the saved state changes |
| Phone buy bar | `animate-sheet-up` from the bottom edge |

Deliberately still: page and tab changes (back-office pages open hundreds of times a day), list rows and search results (data people act on doesn't move), date-picker month changes (keyboard driven), `<details>` disclosures (height would move layout; the chevron turns), and payment or check-in success: no spinners, no celebration (visual spec 12.2). The skeleton pulses only when motion is allowed.

## Overview content

- **Member** (design round C1): `Complete your profile` (links to Account settings) until onboarding is done; **Your next plans**, the next event with a valid ticket (paid order, `active` ticket, not ended) and View tickets; Also coming up (next three); Recent purchases (three newest across families, with the buyer's badge or pickup state); Your memberships (active and upcoming, noting one ending within 14 days doesn't renew); Societies you've joined with upcoming public event counts. No metric tiles. A checkout still confirming is a purchase, never a ticket. The two columns stack independently.
- **Society:** header names the society, its zone and today. **Needs your attention** lists only tasks the viewer can act on (`lib/organisations/overview.ts` reads each only for a role holding its permission): setup (payments `stripe:manage`, profile `organisation:settings`, first event `events:manage`), open payment reviews (`orders:read`), merchandise to prepare (`merchandise:fulfil`), memberships ending within 7 days (`members:read`), failed business emails (`orders:email_resend`), drafts starting within 7 days (`events:manage`). Titled `Get {society} ready` while only setup remains, `All caught up` when empty. Tiles: Upcoming events; Sales this month (since the 1st in the society zone, all families) for finance roles or tickets issued for event managers; Members now with `members:read`. Then Upcoming events (Open calendar) and Recent orders across families (`orders:read`; pending ticket orders and ungranted memberships unlinked). Phones: attention, then events, then tiles.
- **Check-in staff** land on **Today at the door**: Events today in the society zone with valid and checked-in counts and Open check-in, then Later this week. No money, orders, drafts or members.

## Event workspace

- `EventWorkspaceHeader` gives every page of one event the same breadcrumb, title, status and selling badge (Sales open, Sold out, Sales closed), dates in the society zone, place, sales close time and actions. Tabs: Summary (`analytics:read`), Attendees (`tickets:check_in`), Orders (`orders:read`; the orders list filtered to the event, accessible name `Orders for this event`), Edit (`events:manage`), Preview (`events:manage`, drafts only). Tabs hide when only one would show. Edit is titled `Edit event` with the event as a breadcrumb. Without `events:manage` a published event shows View public page.
- `EventActions`: Publish, Edit and a `More` menu (native popover so a scrolling table can't clip it) with View public page, Close or Reopen sales, Unpublish and Delete event. A disabled action shows the server's reason (Publish: the first readiness blocker). Publish and Unpublish send the target status and the loaded version; Unpublish and Delete confirm. The API still enforces every rule; the page refreshes after a change.
- Event form (`components/events/create-event-form.tsx`): cards Details (optional 16:9 image), Schedule (times in the society zone, named; sales close shows the start until changed), Tickets (`$` price, quantity, sold and held per type), Access (Public or Link only, optional capacity) and If tickets cannot be issued. Sticky save bar for unsaved changes. A published event's Edit shows that changes go live on save and holders are emailed only about a new time or place (T30). Rules: [[Event Lifecycle]].
- Attendees: the check-in console ([[Ticket Check-in Implementation]]).

## Public event page and buy box

- `PublicEventView` (`components/events/public-event-view.tsx`) is shared with the organiser's draft preview: 16:9 image, society link, title, date range with zone, location, About, Hosted by with support email and refund policy when set. Below `lg` the ticket box comes before Hosted by; from `lg` it sits in the right column.
- Buy box (`components/events/public-ticket-purchase.tsx`): "Prices in AUD"; each type's price or Free and "N left", Sold out or "Paid tickets unavailable right now"; a Sales closed or Sold out badge replaces the choices when nothing can be bought. One ticket choice, one `Quantity` ("Up to 10 per order"), then `Get free tickets`, `Buy tickets` or `Continue as guest` with the running total, opening the checkout page. The action follows the viewer (sign in, verify email, society account, buy). Below `lg`, while the box's button is off screen, a fixed bottom bar repeats the selection and action; hidden for society and unverified viewers.

## Checkout state screens

The checkout page (`components/purchases/checkout-action.tsx`) shows tickets and total ("Free" and "No payment needed." for free; "No booking fee" for paid), who the tickets go to, the 30-minute hold for paid tickets, and the refund policy and support email when set. The action is `Confirm free registration` or `Pay $X.XX`; it sends the price shown and one idempotency key per reviewed quote, and any server answer ends that key. A 202 shows `Confirming checkout...` while it polls the attempt for up to 30 seconds.

A refusal replaces the action with a titled `Notice` (`role="alert"`) chosen from the API detail's `reason` and `value`, never by parsing the message. Every refusal says nothing has been charged.

| Reason | Notice | Actions |
| --- | --- | --- |
| `quote_changed` | warning "The price changed", new unit price and total; page reloads | `Continue at $X`, `Change tickets` |
| `sold_out` | danger "No tickets remaining" | `Back to ticket options` |
| `insufficient_availability` | warning "Only N tickets left" | `Continue with N tickets` (replaces the quantity), `Change tickets` |
| `sales_closed` | info "Ticket sales have closed" | `Back to the event` |
| `stripe_not_ready` | warning "Paid checkout unavailable", plus "Free tickets are still available." when a free type has stock | `Back to ticket options` |
| `purchase_in_progress` | warning "You already have a checkout in progress" | `Open your checkout`: the open order named by the detail `id` (`/purchases/tickets/[orderId]`, or `/guest/orders/[orderId]` for a guest), which offers Return to payment and Cancel order. Without an `id`: member `Go to Purchases`, guest `Back to ticket options`. Membership and merchandise checkouts link their open order the same way (members only for merchandise) (DEF-053) |
| `free_limit_reached` | warning "You can get N more free tickets", or "You have the most free tickets one person can get" | `Continue with N tickets` and `Change tickets`, or `Back to the event` |
| none, still processing after 30 s | info "We're still confirming your checkout" | `Try again` (same key); members also `Go to My tickets`, guests are told the tickets arrive by email |

Any other failure keeps the button and shows a danger `Notice` with `Change tickets`. An unverified member sees `Verify your email to continue` instead of the action. Guests see "Where should we send your tickets?" (steps Your email, Review, Pay with Stripe) with required First name and Last name, which door staff search by, then "Check your email", then the review showing "Buying as a guest". `tests/e2e/checkout-states.spec.ts` drives the refusals and checks 390 and 1280px for sideways scroll. Not built from the mobile artboard: a struck-through old total and a sticky pay bar.

## Society pages

`SocietyHeader` shows the cover only on Overview (rounded, with a quiet line pattern when there is none); Memberships and Merchandise start with logo and name. Tabs: Overview, and Memberships and Merchandise when there is something to show. Every tab uses the same `SocietyJoinCard` (heading, one line on what joining means, the action, contact). Sign-in or verification never joins automatically.

## Lists and orders

- Orders: tickets, memberships and merchandise share one table shape (buyer and reference, items, total, payment, pickup for merchandise, time). Pending ticket rows are shown only under "Show system orders" and are never linked; pending is not a product status.
- Order detail: breadcrumb `Orders`, title `Order` plus the short reference, status badge. The ticket line uses the purchased ticket name; an order from before T10 shows today's name with "(historical label unavailable)". A Summary card and a `Manage this order` card (resend, refund, record an outside refund through `ConfirmDialog`, verify a compensation refund id, Stripe session with copy and link). `Order history` sits in exactly one `<section>`; browser tests locate it that way.
- Memberships: plans table from 768px with Runs in the society zone, Price or Free, a status (Draft, Published, Ended, Archived) and holders. Plan form: Term (Semester 1, Semester 2, Full year or Custom dates), Details, Price with the fee example, What it unlocks. Member page actions each confirm, ask for a reason and the authenticator code; a refund dialog names the amount and asks for the order's short reference.
- Staff settings: invite with email and `Invitation role` (hint says what the role can do); role changes and revocations confirm; pending invitations and a separate history table; owners also see `Committee handover`.

## Stripe settings

`components/settings/stripe-connect-settings.tsx` renders from the server's Connect state, never from "an account id exists".

| State | Badge | Main action |
| --- | --- | --- |
| `NOT_CONNECTED` | Not connected | `Connect Stripe` |
| `PLATFORM_NOT_READY` | Setup incomplete | `Open Stripe Platform Settings`, `Retry after completion` |
| `CONNECTED_INCOMPLETE` | Setup incomplete | `Continue Stripe setup` |
| `RESTRICTED` | Needs attention | `Fix in Stripe`, with Stripe's reason and requirements |
| `READY` | Ready, or Payouts not set up | `Add a bank account in Stripe` until payouts are on |
| `ERROR` | Out of date | `Try again` |

- Two rows, Can take payments and Can receive payouts, each with its next action, plus the Stripe account id; `Refresh status` and `Open Stripe dashboard` (asks for the authenticator code first when staff MFA is on).
- A Payouts card (`components/settings/payouts-card.tsx`) for a connected society; a failed payout puts a warning above the cards.
- A Fees card with the one-$20.00-ticket worked example from `calculatePlatformFee`.
- `Disconnect Stripe account` (connected states and `PLATFORM_NOT_READY`) sits in its own zone, confirms, and is blocked with "You can't disconnect right now" while open orders need the account. It only unlinks; the Stripe account and its money are untouched.
- A skeleton shows while status loads.

## Design sync

- `.design-sync/` syncs `components/ui/` to the Claude design project as component cards (`.design-sync/config.json`: `srcDir`, `docsMap`, previews in `.design-sync/previews/`). `.design-sync/NOTES.md` records how to run it and its risks; `.design-sync/conventions.md` lists the classes and tokens the design agent may use.
- CSS is compiled first by `node .design-sync/build-css.mjs`. `.design-sync/overrides/source-kit.mjs` drops any `components/ui/*` file importing `next/*` (so `FilterBar`, `LinkTabs`, `Count` are not synced).
- Visual spec section 16.4 lists the implemented primitives; update it with a new primitive.
- After a token or primitive restyle, re-run the sync and spot-check components: grades follow preview sources, not styling.

## Traps

- In an event's Orders tab the sidebar highlights Orders, because that tab is the orders list filtered to the event.
- A new `components/ui/*` file that imports `next/*` silently drops out of design sync.
- Don't add a second `h1`, a second switcher, or a permanent live region.
- Don't style status words in a page; add them to `StatusBadge`.

## Related

[[Frontend and Backend Flow]] · [[Accessibility Review]] · [[Authentication and Dashboard Access]] · [[Stripe Payments and Connect]] · [[Event Lifecycle]] · [[Memberships and Merchandise]] · [[Society Profiles and Assets]]
