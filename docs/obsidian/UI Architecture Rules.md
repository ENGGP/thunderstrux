---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Frontend and Backend Flow]]", "[[Authentication and Dashboard Access]]"]
sources: [app/globals.css, app/layout.tsx, components/layout/navbar.tsx, components/layout/dashboard-shell.tsx, components/layout/personal-shell.tsx, components/ui/button.tsx]
---

# UI Architecture Rules

[Visual Design](../THUNDERSTRUX_COMPLETE_VISUAL_DESIGN_SPEC.md) owns the target presentation. This note records what the code does today and the rules new UI must follow. Every existing screen uses the token source, fonts, primitives and shells described here. Screens for features that are not built yet do not exist.

## Tokens And Fonts

`app/globals.css` is the only token source.

- `:root` defines the `--ts-*` custom properties: ink, brand, paper and surface colours, borders, focus, and five status roles. Success (jade), warning (ochre), danger (crimson), info (brand lilac) and neutral each have a text colour, a `-bg` wash, a `-border` hairline and an `-icon` mark; every text colour is at least 6:1 and every icon colour at least 3:1 on its own wash.
- `@theme inline` exposes them as semantic Tailwind utilities: `bg-paper`, `bg-surface`, `text-ink`, `text-ink-soft`, `bg-brand`, `border-line`, `border-line-strong`, `text-danger`, `bg-warning-bg`, `rounded-control` (9px), `rounded-card` (14px), `shadow-float`, and the widths `max-w-auth`, `max-w-read`, `max-w-checkout`, `max-w-personal`, `max-w-page`, `max-w-admin`.
- New UI uses these names. Do not add raw palette classes such as `bg-neutral-900` or `text-purple-600`, and do not add hex colours in components.
- Bare `border` utilities draw the hairline token; Tailwind's `currentColor` default is overridden in the base layer.
- The keyboard focus ring is a 2px `--ts-focus` outline defined outside any layer, so `outline-none` cannot remove it.
- The first Tab on any page reaches Skip to content, which moves focus to the page's `<main id="main" tabIndex={-1}>`; every page's main keeps that id (T40). A container that scrolls sideways is a focusable region named after its content (`role="region"`, `tabIndex={0}`, `aria-label`), as `ResponsiveTable` does, and a page grid uses `grid-cols-1` so wide content scrolls inside its card instead of widening the page. [[Accessibility Review]] lists what is scanned.
- `app/layout.tsx` loads DM Sans (UI) and Space Grotesk (`h1`, `h2`, `font-display`) through next/font. They are downloaded at build time and served by the app.
- There is no dark mode and no icon library: `components/ui/icon.tsx` holds the few outline icons the UI uses, always decorative beside text. `prefers-reduced-motion` shortens every transition.

## Primitives

`components/ui/` holds the shared primitives. Extend them rather than writing class strings in pages.

- `button.tsx`: `Button` and `buttonClasses()` for links that look like buttons. Variants `primary`, `secondary`, `tertiary`, `danger`; sizes `sm` (36px), `md` (44px), `lg` (48px).
- `input.tsx`: `TextInput`, `TextArea`, `Select`, and `MoneyInput` (a `$` prefix; callers turn the text into cents with `parseMoneyInput`), shared by the event builder and membership plans since T22. The `<label>` contains only the label text. Hint and error text sit outside it and are tied to the control with `aria-describedby`; an error also sets `aria-invalid`.
- `date-field.tsx` (22 Oct 2026): `DateField` and `DateTimeField` replace every browser date and time popup, so dates look and work the same everywhere.
  - `DateField` is a text field people can type into ("22 Oct 2026", "22/10/2026" or `2026-10-22`). Beside it, a calendar button opens a Monday-first month in the house style: today ringed, the chosen day filled, and days outside `min`/`max` disabled.
  - The month works from the keyboard: arrows move by day and week, Home and End go to the week's ends, PageUp and PageDown change month (with Shift, year), Enter picks and Escape closes.
  - With `name`, a hidden input submits `YYYY-MM-DD`, so it works in GET filter forms (Analytics, Orders, Explore). Without one it is controlled (membership plan days).
  - `DateTimeField` is a fieldset holding a `DateField` and a Time list in 15-minute steps, keeping any saved time that is off that grid. It is used for the event builder's Starts, Ends and Ticket sales close. Its value stays the zone-free `YYYY-MM-DDTHH:MM` that `zonedCandidates` resolves (EVT-001).
  - Use these instead of `type="date"`, `type="time"` or `type="datetime-local"`.
- `card.tsx`: bordered surface with an optional `className`.
- `notice.tsx`: inline message in `info`, `success`, `warning` or `danger`: a soft wash, a hairline border, an icon and a toned title, with body text in ink. `action` puts the link or button that resolves the message at the end of the row; `onDismiss` (client callers only) adds a close button. Pass `role="alert"` or `role="status"` only when it reports the result of an action; a page should not gain a permanent live region.
- `status-badge.tsx`: the one mapping from a server status to its words and colour: a pill with a dot and the word. Draft, expired, revoked, unused, Sales closed and Sold out are neutral; Sales open is a success; joined uses the brand accent. Orders show the projection from `lib/purchases/projection.ts`: Processing and Payment review (charged but not fulfilled) are warnings, Paid and Free are successes. Add a status there, not in a page.
- `skeleton.tsx`: `Skeleton` blocks and `ListSkeleton`, a list stand-in with one screen-reader label. They are used only as a `<Suspense>` fallback after a page's guards (see below).
- `confirm-dialog.tsx`: native `<dialog>` confirmation that names the action and its consequences. Its body is mounted only while open, and Escape cancels. Use it instead of `window.confirm`.

Shared content components: `components/events/date-rail.tsx` (day and month in the society's zone, used by event cards, the member overview and My tickets), `components/events/event-card.tsx` (the event image at 16:9 when there is one, date rail, host link, one whole-card event link, dates in the society's zone) and `components/organisations/society-card.tsx`. Neither shows a price or count that the data model does not hold.

Event workspace components live in `components/events/` because they import `next/link`:

- `event-tabs.tsx`: `EventWorkspaceHeader` gives every page of one event the same breadcrumb, title, status, date and place, actions and tabs: Summary (`analytics:read`), Attendees (`tickets:check_in`), Orders (`orders:read`; the orders list filtered to the event, named `Orders for this event`) and Edit (`events:manage`). Tabs are hidden when only one would show. `tabClasses` and `tabBarClasses` style link tabs; the bar scrolls sideways on narrow screens instead of wrapping.
- `event-actions.tsx`: Publish, Edit and a `More` menu (a native popover, so a scrolling table cannot clip it) with View public page, Unpublish and Delete event. A disabled action shows the reason computed by the server read (for Publish, the first blocker from the shared readiness rules); Publish and Unpublish send the target status and the version the page loaded; Unpublish and Delete confirm through `ConfirmDialog`; the API still enforces every rule. After a change the page refreshes from the server.

## Global Header And Footer

`components/layout/navbar.tsx` owns the header, rendered once by `app/layout.tsx`.

- Fixed, 60px high below `md` and 72px from `md`, including its bottom border. `app/layout.tsx` offsets content by the same amounts and `DashboardShell` starts its sidebar at 72px.
- It reads only the session. It never shows a society, a role or an email address.
- Desktop: `Thunderstrux` (to `/`), `Explore events` (`/events`), `Explore societies` (`/societies`); signed in, `My tickets` for member accounts, `Dashboard`, `Account` (`/account/settings`) and a `Sign out` button; signed out, `Sign in` and `Create a society` (`/signup`).
- Below `md`: a native `Menu` disclosure holds the links. `Sign out` (or `Sign in`) stays visible outside it.
- The header owns the link names `Explore events` and `Explore societies`. Other links to the same places use different words (`Events`, `Find a society`, `Browse societies`) so every link name is unique on a page.

`components/layout/site-footer.tsx` is rendered by `app/(public)/layout.tsx` for the society and event pages, and by the home page itself. It lists only destinations that exist; support, terms and privacy links wait for real pages. The public layout does nothing else: no authentication, context or data loading.

### Email verification reminder

`app/layout.tsx` renders `components/layout/verify-email-banner.tsx` under the header for a signed-in user whose email is not verified. Its close button sets the `thunderstrux-verify-dismissed` cookie to the user id for seven days, and the layout skips the banner while that cookie matches. Dismissing never changes verification: `requireVerifiedUser` and `lockVerifiedAccount` still refuse purchases, joins, society creation and invitation acceptance, and those screens prompt where the action happens. The banner is a labelled region, not a live region, and links to `/verify-email`.

## Shells Are Composed By Pages

Each page renders its own shell after its guards have passed. Shells are not placed in route-group layouts: a layout would not re-render when authority changes, and page output is rendered directly by integration tests. No root or dashboard `loading.tsx` exists, because it would stream a 200 where a page currently answers with a redirect or a concealed 404.

Where data loads after the guards, the page wraps that part in `<Suspense>` with a skeleton fallback: the events list, the society Overview, the orders results and the Sales over time chart. A read that decides a redirect or a 404 stays above the boundary, so the status is settled before anything streams; pages whose only read is that decision render in one piece. Integration tests render pages with `renderPage` from `tests/helpers/render.ts`, which waits for every boundary and rethrows errors inside them; `renderToStaticMarkup` would print only the fallbacks.

### Auth shell

`components/layout/auth-shell.tsx` is the narrow column for sign-in, signup, verification, recovery, email-change confirmation, staff invitation acceptance, staff MFA and the payment return pages. It adds a title, an optional description and nothing else: no navigation and no lists.

### Personal shell

`components/layout/personal-shell.tsx` wraps `/dashboard` in personal context, `/dashboard/organisations`, `/tickets`, `/purchases`, `/memberships` and `/account/settings`.

- Navigation: `Overview`, `My tickets`, `Memberships` (T24a), `Societies`, `Purchases`, `Account`. Organisation accounts see `Overview` and `Account` only.
- It shows the context switcher only when the page passes `contexts`; `/dashboard` does. Exactly one switcher is rendered.
- It must never show society management controls.
- Under the switcher it says `Switch to a society you staff to manage its events.`

### Organisation shell

`components/layout/dashboard-shell.tsx` (`DashboardShell`) owns organisation navigation. Do not duplicate these links in page files.

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

The staff authenticator (`/mfa`) is not organisation navigation: it is reached from Account settings, Password and security, and automatically when a page requires verification.

- Filtering is presentation. Every page and API independently enforces the same capability.
- The longest matching route sets `aria-current="page"`.
- `DashboardShell` also owns the page container (one content width, `max-w-admin`, with the page gap), so pages render their sections directly and narrow a form with a `max-w-*` wrapper of their own.
- From `lg` the navigation is a 244px deep-plum column whose contents stick below the fixed header, so the verify-email banner pushes it down instead of sitting under it. Below `lg` the same column holds `Current organisation`, the society name and the `Organisation menu` disclosure.
- Each page renders its own title as the only `h1` through `components/layout/page-header.tsx` (or an `h1` of its own); section headings are `h2`. The society name is plain text in the sidebar.
- The workspace switcher is labelled `Workspace`.
- A navigation item is added only when its destination exists. Analytics arrived with T32, Calendar with T33 and History with T38. OpenClaw is deferred (19 Oct 2026) and gets no item or page until the maintainer schedules it. Memberships arrived with T22; its Plans and Members tabs (T23a) show only to staff with `memberships:manage` and `members:read` respectively.

### Context switcher

`components/layout/context-selector.tsx` receives its choices from the server with the page. `requireManagementPage` returns them after both guards pass, and `/dashboard` passes the context it already loads; the browser does not fetch them. Selecting a context records a signed, login-bound preference through `POST /api/me/context` and carries no authority.

## Account-Specific Dashboards

`/dashboard` is role-aware.

Member accounts in personal mode, including named staff on a fresh login:

- See a `Complete your profile` prompt (linking to Account settings, Profile) until onboarding is complete, their nearest upcoming paid tickets and joined societies inside the personal shell. The overview has no metric tiles.
- Can navigate to `/dashboard/organisations` to search and join organisations.
- Can browse public events and view `/tickets`.
- Must not see organisation management navigation.

Explicitly selected live staff context and permitted legacy organisation context:

- See the permitted organisation dashboard at `/dashboard` inside `DashboardShell`.
- Use slugless management routes: `/dashboard/events`, `/dashboard/orders`, `/dashboard/settings`.

Legacy `/dashboard/[orgSlug]/*` routes are compatibility redirects only.

## Page Responsibilities

`/dashboard`

- Member (T34, design round C1):
  - A profile prompt that links to Account settings (the form lives there only).
  - **Your next plans**: the next event the member holds a valid ticket for (paid order, `active` ticket, not yet ended), with its image and View tickets. A checkout still confirming or in payment review is a purchase, never a ticket here.
  - Also coming up (the next three events with tickets).
  - Recent purchases: the three newest across tickets, memberships and merchandise, with the buyer's badge, or the pickup state for a paid merchandise order waiting to be collected.
  - Your memberships: active and upcoming, noting that a membership ending within 14 days doesn't renew automatically.
  - Societies you've joined, with how many public events are coming up. Leaving stays on the Societies page.
  - The two columns stack independently, so a short card never leaves a gap beside a tall one.

`/tickets` (My tickets)

- One card per paid order: date rail, event link, date and society, quantity and total, ticket numbers (last six characters, full id in the title) and `Order` plus a short reference. The list streams behind a skeleton after the sign-in guard.

`/account/settings`

- `On this page` links to Profile (members), Password and security, Email address and Close account. A `Signed in as` summary shows the email, account type and verification state.
- The authenticator row appears only for people who could use it, decided by the same eligibility check `/mfa` uses (active staff, legacy owner, or already enrolled). Everyone else sees password, security activity, email and closure only.
- Closure lists its blockers in a warning notice; the confirmation fields stay disabled until they are resolved.
- Organisation (T34, design round C1): the header names the society, its zone and today.
  - **Needs your attention** lists only tasks the viewer can act on (`lib/organisations/overview.ts` reads each one only for a role that holds its permission). It is headed `Get {society} ready` while only setup steps remain, and shows `All caught up` when nothing is left, so the card keeps its place.
    - Setup: payments (`stripe:manage`, warning tone), the society profile (`organisation:settings`) and a first event (`events:manage`).
    - Open payment reviews in either family (`orders:read`, warning tone).
    - Merchandise orders to prepare, with the oldest paid date and how many are ready (`merchandise:fulfil`).
    - Memberships ending in the next 7 days, and whether a next plan is on sale (`members:read`; the link plans one with `memberships:manage`).
    - Business emails that failed (`orders:email_resend`).
    - Drafts starting within 7 days (`events:manage`).
  - Tiles: Upcoming events with the next one; Sales this month (gross since the 1st in the society's zone, all three families) for finance roles, or Tickets issued this month for event managers; Members now with `members:read`.
  - Upcoming events with date rails and Open calendar, then Recent orders across tickets, memberships and merchandise (`orders:read`). A pending ticket order and a membership not yet granted are listed without a link.
  - On phones the attention card comes first, then upcoming events, then the tiles.
  - Check-in staff land on **Today at the door** instead: today's published events in the society's zone with valid and checked-in tickets and Open check-in, then the rest of the week. There is no money, no orders, no drafts and no members.

`/dashboard/history` (T38, design round C2)

- Owners and admins (`audit:read`); for anyone else the address is Page not found.
- Filters in the URL: What (a category; Check-ins only under their own, never in All activity), Who (people in this society's History, Stripe or Thunderstrux), From and To (society-zone days with the house `DateField`). `?cursor=` pages 50 at a time; a stale cursor starts again from the newest with a notice.
- Day headings, then a rail of entries: time, the actor's initials (Stripe dark, Thunderstrux outlined, a former staff member dashed), the sentence with links to the event, order, member, plan or product, and a box of facts with before → after. The category tag sits in a fixed right-hand column so tags and fact boxes line up.
- Sentences and facts come only from `lib/audit/history.ts`, which names the fields each action may show; nothing else in `metadata` reaches the page. An edit recorded before T38 says "Historical detail unavailable".
- States: Nothing recorded yet, No matches with Clear filters, the start of the history, loading skeleton. See [[Audit Coverage]].

`/dashboard/events`

- Server-rendered for every role from one read (`listDashboardEvents`): views Upcoming (not yet ended; the default), Drafts, Past and All with counts, plus a title search, all in the URL (`?view=`, `?q=`). A table from `md`, one card per event below it.
- `N sold · N left` appears only with `analytics:read` (sold counts paid orders); actions only with `events:manage`. Check-in staff see published events only, get no Drafts view, and their links open Attendees.
- Each view shows up to 100 events and says so when there are more.

`/dashboard/events/[eventId]` (Summary), `/dashboard/events/[eventId]/tickets` (Attendees), `/dashboard/events/[eventId]/edit` (Edit) and `/dashboard/orders?eventId=` (Orders)

- Share `EventWorkspaceHeader`: dates in the society time zone, the sales close time, and Published with a selling badge (Sales open, Sold out, Sales closed). Summary shows tickets sold, tickets left, capacity when set, checked in and, with `orders:read`, net sales; the ticket table (price, sold, held, left, revenue and share); Sales over time in the society's zone (T31); and a draft's readiness checklist (`components/events/readiness-checklist.tsx`) or a published event's selling status. More offers Close sales or Reopen sales.
- Edit is titled `Edit event` with the event as a breadcrumb; a published event shows a notice that changes go live on save and ticket holders are emailed only about a new time or place (T30). `/dashboard/events/new` has its own `New event` header.
- The event form (T11b) has five cards: Details with the optional 16:9 event image, Schedule (times in the society's zone, named in the card; sales close shows the start until changed), Tickets (a `$` price, quantity, sold and held per type), Access (Public or Link only, optional capacity) and If tickets cannot be issued. A sticky save bar says when there are unsaved changes; leaving asks first. A draft's Edit page shows the readiness checklist beside the form. A version conflict keeps the edits and offers a reload.

`/dashboard/orders`

- Renders canonical tenant-scoped order review for callers with live finance capability, regardless of account role.
- Status views (All, Paid, Expired, Failed) are link tabs; buyer email, an Event list of the society's events and a date range filter through the URL. One table lists the page newest first: buyer, event and ticket, quantity, total, status and time. Results stream behind a skeleton.
- Family tabs (T29b): Tickets (the default, everything above), Memberships and Merchandise (`?family=`). The commerce tabs have status pills (All, Paid, Free, Refunded, Payment review, Expired), buyer email, plan or product and date filters, and the same table: buyer and order reference, items or plan and term, total, payment, pickup (merchandise) and time. Rows open the staff merchandise order page or the member's page; both open for `orders:read` as well as their own permission, so finance managers see money actions there but not pickup steps or the roster. An event's Orders view stays on tickets.
- Lists use `ResponsiveTable` (`components/ui/responsive-table.tsx`, T29b): a bordered table from 768px and the caller's cards below, used by ticket orders, commerce orders and Pickups.
- Normal filters hide internal pending orders. `Show system orders` may expose pending orders for debugging, but pending must not be presented as a normal product status, and a pending row is not linked because order detail serves settled orders only.

`/dashboard/orders/[orderId]`

- Breadcrumb `Orders`, title `Order` plus the last six characters of the id, and the status. The ticket line uses the purchased ticket name; an order from before T10 shows today's name with "(historical label unavailable)". The note that contact details were captured from the account profile appears only for closure captures, not for contacts recorded at purchase. A Summary card (buyer, event, tickets, total, ordered, paid, full order id) and a `Manage this order` card: resend tickets, record a refund made outside Thunderstrux (confirmed through `ConfirmDialog` because it cannot be undone) or, for a compensation case, verify the Stripe refund id, and the Stripe session with copy and a Stripe link.
- `Order history` sits in exactly one `<section>` (a `Card`); browser tests locate it that way.

`/dashboard/events/[eventId]/tickets` (Attendees)

- Checked in, not yet and total tiles; cards on phones and a table from `md`. Each button names its attendee for screen readers; a checked-in ticket shows the time and `Undo check-in`.

`/dashboard/notifications` (Email delivery)

- Lists failed society emails with their last error. `Send again` needs a review reason (8 to 500 characters) recorded with the retry, and reports the result.

`/dashboard/settings` (Payments)

- Renders Stripe Connect settings. State-specific Connect controls are allowed here because they are settings content, not dashboard navigation. Since PAY-005 (round F1) a connected society also sees a Payouts card (`components/settings/payouts-card.tsx`) between the Stripe account and Fees cards, and a refused payout puts a warning above them. A skeleton shows while the status loads; disconnecting sits in its own zone and asks for confirmation.

`/dashboard/organisations`

- Renders caller-only joined societies and bounded paged search. Explicit verified Join changes free affiliation only; Leave synchronises both views after refresh and never revokes staff or paid purchases.

`/events` (T15b) is Explore events: a `FilterBar` (`components/ui/filter-bar.tsx`, a GET form with Clear, also used by the orders list) with Search by title, When (Upcoming, This week, This month, Choose dates with From and To, at most 366 days; presets run in Brisbane time) and Society, all kept in the URL. Below `md`, When and Society fold behind a Filters toggle that counts the filters on. Invalid values show as field errors and the list waits until they are fixed. `EmptyState` (`components/ui/empty-state.tsx`) says either "No events match these filters" with Clear filters or "No upcoming events yet" with Explore societies; a failed read is a danger `Notice`, never an empty list. Twenty cards a page with Earlier events and Later events links. The home page shows the next six events and an Explore all events link.

`/societies` and `/societies/[orgSlug]` render anonymous discovery and public profile content. `/organisations` and `/organisations/[orgSlug]` redirect to them permanently. Profile join controls are personalized and dynamic; sign-in/verification never automatically joins. `/dashboard/settings/profile` (Settings) is the live-settings/MFA-protected resumable editor: four steps, a timezone list computed on the server, and a Finish step whose checklist shows only facts the caller may see (profile complete, payments ready, team size). On a version conflict it keeps the edits and offers `Save my version` or a confirmed reload.

`/dashboard/settings/staff` (Staff) invites with an email and `Invitation role` whose hint says what the role can do, confirms a role change or revocation through `ConfirmDialog` and reports the result, lists pending invitations, and shows the latest accepted, revoked and expired invitations in a separate history table. Revoking an invitation is immediate. Owners also see `Committee handover`, built from the same primitives.

`/dashboard/create` uses the auth shell and asks only for the society name. [[Society Profiles and Assets]] owns their full contracts.

`/events/[eventId]` is public (T15a) and renders `PublicEventView` (`components/events/public-event-view.tsx`), shared with the organiser's draft preview: the 16:9 image across the page, the society link, title, date range with its time zone and location, About, and Hosted by with the support email and refund policy when set. The ticket box shows "Prices in AUD", each type's price or Free and N left, Sold out or "Paid tickets unavailable right now"; a Sales closed or Sold out badge replaces the choices when nothing can be bought, and its action follows the viewer (sign in, verify email, society account, or buy). The buy box offers one ticket choice (price or Free, "N left", sold-out types disabled), one `Quantity` (hint "Up to 10 per order") and `Get free tickets` or `Buy tickets` with the running total, then opens the checkout page.

`/events/[eventId]/checkout?ticketTypeId=&quantity=` (T13) is the one review page for every ticket purchase, in `CheckoutShell` (`components/layout/checkout-shell.tsx`: "Booking for {society}", Change tickets, steps) with `MoneySummary` (`components/purchases/money-summary.tsx`). It shows the tickets and total ("Free" and "No payment needed." for a free registration; "No booking fee" for paid), who the tickets go to, the 30-minute hold for paid tickets, and the society's refund policy and support email when set. The event sits in the aside with the total and the one action, `Confirm free registration` or `Pay $X.XX` (`components/purchases/checkout-action.tsx`). The action sends the price shown and one idempotency key per reviewed quote; any server answer ends that key, so a new price or quantity goes out under a new one. A 202 shows `Confirming checkout...` while it polls the attempt for up to 30 seconds.

Checkout state screens (design round A1, artboards CheckoutStatesA1 and CheckoutStatesA1Mobile) replace the action with a titled `Notice` (`role="alert"`) and its own actions. The screen is chosen from the API detail's `reason` and `value` (see [[API Reference]]), never by parsing the message, and every refusal says "Nothing has been charged":

| API reason | Notice | Actions |
| --- | --- | --- |
| `quote_changed` | warning, "The price changed": new unit price and total; the page reloads so the summary shows the new price | `Continue at $X` (resubmits at the new price), `Change tickets` |
| `sold_out` | danger, "No tickets remaining" | `Back to ticket options` |
| `insufficient_availability` | warning, "Only N tickets left": the count left and the count asked for | `Continue with N tickets` (replaces the address quantity and resubmits), `Change tickets` |
| `sales_closed` | info, "Ticket sales have closed" | `Back to the event` |
| `stripe_not_ready` | warning, "Paid checkout unavailable"; adds "Free tickets are still available." when the event has a free type with stock | `Back to ticket options` |
| none: still processing after 30 seconds | info, "We're still confirming your checkout" | `Try again` (same key), `Go to My tickets` |

Any other failure keeps the button and shows the message in a danger `Notice` with `Change tickets`. `tests/e2e/checkout-states.spec.ts` drives the refusals from real API answers and checks 390 and 1280px for sideways scroll. Not built from the mobile artboard: the struck-through old total in the summary and a sticky pay bar. An unverified member sees `Verify your email to continue` instead of the action; the API still enforces verification. A visitor who chose Continue as guest (T16b, `?guest=1`) first sees "Where should we send your tickets?" (`GuestEmailForm`, steps Your email, Review, Pay with Stripe) and then "Check your email"; the link brings them back to the same review, now showing their confirmed address and "Buying as a guest". A guest's finished checkout lands on `/guest/orders/[orderId]`: the Paid or Free badge, the tickets, where they were sent, the society's contact and refund policy, a "Keep your tickets in one place" prompt and Find your tickets. `/guest/recover` is Find your tickets; its answer never says whether the address has orders. Since T16c the guest order page states its account standing: "Keep your tickets in one place" when nobody is signed in; "Verify your email to add this order"; "This order uses a different email"; the "Add this order to your account?" notice whose button opens a `ConfirmDialog` ("Add to your account?", "This can't be undone"), then "Added to your account" with a My tickets link; "This order is in your account"; or "Already in an account". A free registration, or a polled attempt that completes, lands on `/events/[eventId]/checkout/confirmed?orderId=`: the buyer's own order for that event, its ticket numbers, `View my tickets` and `Back to the event`. My tickets badges each order Paid or Free and says Registered for free orders. The home page streams its event and society listings behind a skeleton under the hero; `/societies` and `/events/[eventId]` keep their public `loading.tsx`, built from `Skeleton`.

`/success` and `/cancel` are the payment return pages. `/success` says `Checking payment status` and links to My tickets; it never states that a payment succeeded, because only the signed webhook establishes that.

`app/not-found.tsx` and `app/error.tsx` are the shared missing-page and failure pages. The missing page is also what a foreign tenant resource renders and must not hint at whether the resource exists.

### Membership plans (T22)

`/dashboard/memberships` lists plans as a table from 768px and cards below, with Runs in the society's zone, Price (or Free), a status badge (Draft, Published, Ended, Archived), the holders and a Details or Edit link. `/dashboard/memberships/new` and `/dashboard/memberships/[planId]` share `components/memberships/plan-form.tsx`: Term (Semester 1, Semester 2, Full year or Custom dates, a year, then First day and Last day), Details, Price with the fee example, and What it unlocks; an unsaved-changes guard; a 409 on a stale version keeps the edits and offers Reload. A sold plan disables everything but the description under an information notice; an archived plan is read-only. The detail page's aside holds the publish check (`plan-checklist.tsx`, the server's blockers in a fixed order with a Payments link), Publish and Archive (`plan-actions.tsx`; Archive confirms and names what it does not undo), and a preview of the buyer's offer card. Design round B1 on the canvas is the approved source.

`/dashboard/memberships/members` (T23a) uses view pills (Active, Upcoming, Expired, Revoked, then Free joins set apart) with counts, a search form, a table from 768px and a list below, Next page links, and a note that members, joins and staff are different lists. The member page has Membership and With the society cards and, for staff who may end it, a Manage this membership card (T23b): Refund membership for a paid one (`orders:refund`; the dialog names the amount and asks for the order's short reference, T23c), Revoke membership (`memberships:manage`) or, for a free membership, Cancel free membership (`orders:refund`), each through a ConfirmDialog that names what happens and asks for a reason and the authenticator code. An ended-early membership shows an information notice with who ended it, when and why. `upcoming` joins the badge words (accent).

## Stripe Settings UI Rules

The Stripe Connect settings card should render from backend lifecycle state:

- `NOT_CONNECTED`: connect button only.
- `PLATFORM_NOT_READY`: platform settings link, retry button, and local disconnect button.
- `CONNECTED_INCOMPLETE`: continue onboarding.
- `RESTRICTED`: fix account and show requirements if Stripe provides them.
- `READY`: show readiness and cached flags.
- `ERROR`: show clear error and recovery actions.

Since T17 (design round A2) the card shows two rows, Can take payments and Can receive payouts, each with its next action, a Fees card with the $20.00 worked example, and a Disconnect block that is disabled with the open-order count while orders depend on the account and asks for an authenticator code when staff MFA is on. The event builder shows under each paid price "For one ticket you receive $X after the Thunderstrux fee (3.75% plus $0.89 a ticket), which includes card processing" (computed with `calculatePlatformFee`), plus a set-up-payments link while the society cannot take payments; a free price says no fee or setup is needed. The state shows as a status badge (Not connected, Setup incomplete, Payouts not set up, Ready, Needs attention, Out of date) with a notice that explains it and lists what Stripe still requires. Always show the readiness rows when status exists:

- Stripe account (the account id)
- Card payments
- Payouts
- Details submitted

Do not call an account "ready" just because `stripeAccountId` exists.

`Disconnect Stripe account` is local-only and asks for confirmation first. It may appear for connected states and `PLATFORM_NOT_READY`. It clears local organisation Stripe fields and does not delete the Stripe account in Stripe.

## Known UI Inconsistencies

- In an event's Orders tab the sidebar highlights Orders, because that tab is the orders list filtered to the event.
- The event builder, order, check-in and payment screens keep their pre-specification structure under the new presentation; their target layouts belong to T11-T19.

## Notification Recovery

The shared DashboardShell owns the Email delivery navigation link. `/dashboard/notifications` requires live email-resend authority and renders a bounded failed-business-job list, review-reason forms, accessible status/error feedback and pagination. Account-security jobs are private and absent.
