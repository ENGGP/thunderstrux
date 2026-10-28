---
status: living
last-reviewed: 2026-10-28
owner: engineering
related: ["[[Frontend and Backend Flow]]", "[[Accessibility Review]]", "[[Authentication and Dashboard Access]]"]
sources: [app/globals.css, app/layout.tsx, components/ui, components/layout/navbar.tsx, components/layout/site-footer.tsx, components/layout/dashboard-shell.tsx, components/layout/personal-shell.tsx, components/events/event-tabs.tsx, .design-sync/config.json, PRODUCT.md, DESIGN.md]
---

# UI Architecture Rules

**Owns:** design tokens and fonts, the `components/ui/*` primitives, the shells and global header and footer, shared UI patterns and copy rules, and the design-sync setup.
**Read when:** building or restyling any screen, adding a primitive or status, or changing navigation.
**Not here:** how particular pages are laid out (overview, event workspace, buy box, checkout states, society pages, orders) ([[UI Page Patterns]]); which page lives where, its guard and data ([[Frontend and Backend Flow]]); what is scanned for accessibility ([[Accessibility Review]]); target presentation ([[THUNDERSTRUX_COMPLETE_VISUAL_DESIGN_SPEC|Visual Design]]); Connect states and their meaning ([[Stripe Payments and Connect]]).

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
| Design-tool context | `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json` |

## Tokens and fonts

- `:root` defines the `--ts-*` properties: ink, brand, paper and surface colours, borders, focus, and five status roles. Success (jade), warning (ochre), danger (crimson), info (brand lilac) and neutral each have a text colour, a `-bg` wash, a `-border` hairline and an `-icon` mark. Every text colour is at least 6:1 and every icon colour at least 3:1 on its own wash.
- `@theme inline` exposes them as semantic utilities: `bg-paper`, `bg-surface`, `text-ink`, `text-ink-soft`, `bg-brand`, `border-line`, `border-line-strong`, `text-danger`, `bg-warning-bg`, `shadow-float`, and so on.
- Type: `text-caption` (13px, meta lines and counts) and `text-ui` (15px, dense body) sit between the scale's steps. Use them, not `text-[13px]`/`text-[15px]`; only display sizes (17px and up) keep arbitrary values.
- Corners: `rounded-tag` (6px), `rounded-control` (9px), `rounded-card` (14px), `rounded-feature` (20px); not `rounded-md`/`-lg`/`-xl`.
- Widths: `max-w-auth`, `max-w-read`, `max-w-checkout`, `max-w-personal`, `max-w-page`, `max-w-admin` (values in `app/globals.css`).
- No raw palette classes (`bg-neutral-900`, `text-purple-600`) and no hex colours in components.
- Bare `border` draws the hairline token; Tailwind's `currentColor` default is overridden in the base layer.
- The focus ring is a 2px `--ts-focus` outline outside any layer, so `outline-none` cannot remove it. `prefers-reduced-motion` sets every transition and animation to `0s`; not `0.01ms`, because every element defaults to `transition-property: all`, so any duration starts a transition on every style change. Read straight after focusing, the focus ring then still reports its 3px default (`tests/e2e/society-profiles.spec.ts` caught this).
- Motion tokens sit in their own `@theme` block: `ease-out` is the strong curve `cubic-bezier(0.23, 1, 0.32, 1)`, `ease-drawer` is `cubic-bezier(0.32, 0.72, 0, 1)` for bottom sheets, `animate-pop-in` (160ms), `animate-dialog-in` (200ms) and `animate-fade-in` (200ms) are entry keyframes, `animate-sheet-in` (240ms, `ease-drawer`) slides phone bottom sheets up, `animate-reveal` (200ms) opens a result's row from `0fr` while it fades in, and `animate-rise-in` (300ms, `backwards` fill) drives the `issued-stagger` utility. Reduced motion also zeroes animation delays. Where they are used: [[#Motion]].
- `app/layout.tsx` loads DM Sans (UI) and Space Grotesk (`h1`, `h2`, `font-display`) through `next/font`; they are downloaded at build time and served by the app.
- No dark mode. No icon library: `components/ui/icon.tsx` holds the outline icons, always decorative beside text.

## Primitives

`components/ui/` holds the shared primitives. Extend them rather than writing class strings in pages.

| File | What | Rules |
| --- | --- | --- |
| `button.tsx` | `Button`, `buttonClasses()` for links styled as buttons | Variants `primary`, `secondary`, `tertiary`, `danger`; sizes `sm` (`h-9`, 36px), `md` (`h-11`, 44px, default), `lg` (`h-12`, 48px). Every variant has a border (transparent where none shows), so disabled never adds width. `busy` + `busyLabel` (a string) for work in progress: `aria-busy`, clicks blocked, the brand colour kept (busy is not unavailable), no spinner, and the busy label drawn by `::after` in the label's grid cell, so the button is always as wide as the longer label and the busy text is never part of its text. Never swap a label in the children |
| `input.tsx` | `Field`, `TextInput`, `TextArea`, `Select`, `MoneyInput` | The `<label>` holds only the label text; hint and error sit outside and are tied with `aria-describedby`; an error sets `aria-invalid`. `MoneyInput` has a `$` prefix; callers turn text into cents with `parseMoneyInput` (`lib/format.ts`) |
| `date-field.tsx` | `DateField`, `DateTimeField` | Replace every `type="date"`, `type="time"` and `type="datetime-local"`. `DateField` accepts "22 Oct 2026", "22/10/2026" or `2026-10-22` and has a Monday-first calendar (today ringed, chosen day filled, outside `min`/`max` disabled). Keyboard: arrows by day and week, Home/End to week ends, PageUp/PageDown by month (Shift: year), Enter picks, Escape closes. With `name` a hidden input submits `YYYY-MM-DD` for GET filter forms; without it, it is controlled. `DateTimeField` adds a Time list in 15-minute steps, keeps a saved off-grid time, and emits zone-free `YYYY-MM-DDTHH:MM` that `zonedCandidates` (`lib/zoned-time.ts`) resolves |
| `card.tsx` | `Card` | Bordered surface |
| `notice.tsx` | `Notice` | Tones `info`, `success`, `warning`, `danger`: wash, hairline, icon, toned title, ink body. `action` ends the row; `onDismiss` (client only) adds a close button. Pass `role="alert"` or `role="status"` only for the result of an action. `reveal` for a result appearing after an action: its row opens smoothly (`animate-reveal`); `className` then goes on the wrapper |
| `status-badge.tsx` | `StatusBadge` | The one map from a status to its word and colour (pill, dot, word). Add a status there, never in a page |
| `link-tabs.tsx` | `LinkTabs`, `tabClasses`, `tabBarClasses`, `pillClasses`, `pillBarClasses`, `Count`, `TabLabel` | URL-driven tabs and pills; see Patterns. `event-tabs.tsx` re-exports `tabClasses` and `tabBarClasses`. `TabLabel` wraps a tab's or header link's text and reserves its semibold width (a hidden `::after` copy), so the current tab changing never moves its neighbours |
| `filter-bar.tsx` | `FilterBar` | A GET form with Clear; every filter lives in the URL |
| `empty-state.tsx` | `EmptyState` | One reason and one action for an empty list |
| `responsive-table.tsx` | `ResponsiveTable` | Bordered table from 768px (a focusable region named after its content), the caller's cards below |
| `audit-timeline.tsx` | `AuditTimeline` | One history list in exactly one `<section>`, so a page has one place its history lives |
| `skeleton.tsx` | `Skeleton`, `ListSkeleton`, `CardGridSkeleton` | Only as a `<Suspense>` fallback after a page's guards; each stand-in has one screen-reader label. A stand-in has the shape of what replaces it (`CardGridSkeleton` for event card grids; a list card for lists), so nothing jumps when it streams in |
| `confirm-dialog.tsx` | `ConfirmDialog` | Native `<dialog>` naming the action and its consequences; body mounted only while open; Escape cancels and never confirms, not while busy. Use instead of `window.confirm` |
| `icon.tsx` | `Icon` | Decorative outline icons |

Shared content components: `components/events/date-rail.tsx` (day and month in the society's zone), `components/events/event-card.tsx` (16:9 image when there is one, date rail, host link, place, then the price or selling state, one whole-card link), `components/organisations/society-card.tsx` and `components/merchandise/product-tile.tsx` (`ProductTile`: the shop grid tile, shared by the Merchandise tab and the Overview preview). They show only what the data holds. An event card's line comes from `listingAvailability` (`lib/events/public-events.ts`): the standard prices on sale now through `listingPriceLabel` (`lib/format.ts`: "Free", "$12.00", "From $12.00", "Free or $15.00"), a Sold out or Sales closed badge, or "Paid tickets unavailable right now"; member prices show on the event page. A list of `EventCard`s passes `media` when any event has an image, so every card gets the same 16:9 area from `sm`; phones (one column) skip an empty area.

## Shells

Each page renders its shell after its guards pass; shells are never in route-group layouts (a layout would not re-render when authority changes, and integration tests render page output directly).

- **Auth shell** (`AuthShell`): narrow column for sign-in, signup, verification, recovery, email-change confirmation, guest access, staff invitation, staff MFA, `/dashboard/create` and the payment-return fallbacks. Title, optional description, nothing else.
- **Checkout shell** (`CheckoutShell`): every purchase step. "Booking for {society}" ("Buying from" for memberships and merchandise, `lead`), a way back (Change tickets, Back to basket), the steps, then the content and its summary.
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
- Links: `Thunderstrux` (`/`), `Explore events`, `Explore societies`; signed in, `My tickets` (members), `Dashboard`, `Account` and a `Sign out` button; signed out, a quiet `Create a society` link (`/signup?for=society`), `Sign in` and a `Sign up` button (`/signup`, a member account), so a student never has to pick the society route to sign up. Home shows society calls to action only to signed-out visitors, because a society needs its own account.
- Below `md` a native `Menu` disclosure holds the links (signed out: Sign up and Create a society); Sign out or Sign in stays outside it.
- The current section is ink with a 3px brand rule on the header's bottom edge; its label is a `TabLabel`, so the semibold weight doesn't nudge the other links.
- On any `/checkout` path the header drops its browsing links and Menu (visual spec 3.3).
- The header owns the names `Explore events` and `Explore societies`; other links to those places use other words (`Events`, `See what's on`, `Find a society`, `Browse societies`) so link names stay unique.
- `SiteFooter` is rendered by `app/(public)/layout.tsx` (which does nothing else: no auth, context or data) and by the home page. Links: Events, Societies, Fees, Help, Privacy. Terms waits for legal drafting (LEGAL-001). The page area is a column at least one screen tall and the footer takes `mt-auto`; a page's centred `main` needs `w-full` beside `mx-auto`.
- **Verify-email banner** (`components/layout/verify-email-banner.tsx`): under the header for a signed-in, unverified user. Close sets `thunderstrux-verify-dismissed` (`lib/auth/verify-banner.ts`) to the user id for seven days. Dismissing changes nothing: `requireVerifiedUser` and `lockVerifiedAccount` still refuse purchases, joins, society creation and invitation acceptance, and those screens prompt in place. A labelled region, not a live region; links to `/verify-email`.

## Patterns

- **Headings:** each page has one `h1` (`PageHeader` or its own), sections are `h2`. On public pages a section `h2` is 24px (`text-2xl`) and a panel's own heading (the buy box, the join card) 20px (`text-xl`). Every page sets `metadata` (`{title} · Thunderstrux`); public and link-only events and society pages use their own name, members-only pages stay generic.
- **Main landmark:** every page's `<main id="main" tabIndex={-1}>` is the Skip to content target.
- **Tabs vs pills:** sections are link tabs (`tabClasses`, `LinkTabs`); the bar scrolls sideways on narrow screens instead of wrapping. Status filters inside a tab are pills (`pillClasses`: Orders, Pickups, Members), never a second row of tabs. Every count on a tab or pill uses `Count`.
- **Filters:** `FilterBar` GET forms; every filter, view and cursor is in the URL. A stale cursor falls back to the first page with a warning notice, never an error.
- **Empty vs failed:** an empty list is an `EmptyState` (one reason, one action; "No matches" offers Clear filters). A failure or denied access is a `Notice`, never "nothing here".
- **Statuses:** always `StatusBadge`. Draft, expired, revoked, unused, Sales closed and Sold out are neutral; Sales open, Paid and Free are success; Processing and Payment review (charged, not fulfilled) are warnings; joined and upcoming use the brand accent. Orders show `ticketOrderProjection` (`lib/purchases/projection.ts`). Pickup is always a separate badge from payment.
- **Lists:** `ResponsiveTable` for dashboard lists (orders, commerce orders, Pickups, members); page grids use `grid-cols-1` so wide content scrolls inside its card.
- **Money copy:** amounts through `formatMoney`/`formatPrice` (`lib/format.ts`, AUD; `formatPrice` says "Free" for zero). Buy boxes say "Prices in AUD". Never claim a payment succeeded from the browser; only the signed webhook establishes it. The fee line under a paid price: "For one ticket you receive $X after the Thunderstrux fee (3.75% plus $0.89 a ticket), which includes card processing" (computed with `calculatePlatformFee`, `lib/stripe/fees.ts`), plus a set-up-payments link while the society cannot take payments; a free price says "Free. No fee and no payment setup needed."
- **Dates:** in the society's IANA zone (`formatDateTime`, `zoneCity`), default `Australia/Brisbane`; name the zone where times are listed. Order references are the last six id characters, upper case (`orderReference`).
- **Confirmations:** destructive or irreversible actions use `ConfirmDialog` naming what happens and what it does not undo; results report through a `Notice` with a live role.
- **Results under the action:** a result (saved, refused, sent, copied) shows directly under the button that caused it, with `reveal`, never at the top of the form or card, so nothing above moves and the person sees it where they pressed. A card with several actions keeps which action a result belongs to. When a result replaces the pressed control, focus moves to it. No permanent live region: a result's `role` mounts with it.
- **Busy buttons:** `busy` and `busyLabel`, never a label swap; one busy flag per action, so pressing one button never relabels another.
- **Concurrency:** a version conflict (409) keeps the user's edits and offers a reload (profile also offers `Save my version`); unsaved-change guards ask before leaving.

## Motion

Motion shows where something came from or confirms that a change happened, and only after the server has answered (visual spec 2.4). Only `opacity`, `scale` and `translate` move. Buttons and header links cross-fade their colours on hover over 150ms, and the buy bar's `visibility` switches with its slide. **Menus and the dialog animate in and close instantly:** `ConfirmDialog` unmounts its body on close, and a chosen menu action shouldn't wait on a fade. Phone bottom sheets slide through the bottom edge: the buy bar both ways, the date picker in.

| Where | Motion |
| --- | --- |
| `buttonClasses()` and the check-in button | Press: scale to 97% over 150ms (`active:not-disabled:scale-97`) |
| `EventActions` More menu | `animate-pop-in` from the trigger (`placeMenu` sets the origin above or below). It animates only when opened with a pointer; from the keyboard (a click with `detail` 0) it opens instantly |
| `DateField` calendar | On phones a sheet that slides up through the bottom edge (`animate-sheet-in`, 240ms, `ease-drawer`), like the buy bar; from `sm` `animate-pop-in` from the field (`origin-top-left`). Both only for a pointer open; from the keyboard (a click with `detail` 0, or Alt+↓) it opens instantly |
| `ConfirmDialog` | `animate-dialog-in` from the centre; the backdrop fades in |
| Phone action bar (`components/purchases/phone-action-bar.tsx`: the event buy box and every checkout) | Slides in and out through the bottom edge (240ms, `ease-drawer`), as a transition so a scroll reversal mid-slide retargets. It stays mounted; while hidden it is `invisible` and `inert` |
| A result `Notice` with `reveal` | Its row opens from nothing while it fades in (`animate-reveal`, 200ms), so content below eases down instead of jumping |
| Newly issued tickets: the ticket list on `/purchases/tickets/[orderId]` and `/guest/orders/[orderId]`, the confirmation on `/success`, and the ticket numbers on `/events/[eventId]/checkout/confirmed` | `issued-stagger` while the order is live (paid or free) and `justIssued(order.fulfilledAt)` (`lib/purchases/projection.ts`) is true, which is two minutes after issue. Items fade and rise 8px over 300ms, 50ms apart (capped at 250ms). This covers both the status poller's refresh and landing after the webhook. A later visit is still; a reload inside the window replays it |

Deliberately still:
- Page and tab changes: back-office pages open hundreds of times a day.
- List rows and search results: data people act on doesn't move.
- Check-in cards: the new state shows at once at the door.
- A `Notice` that is part of the page (guidance, state) rather than a result.
- The navbar `Menu` and every `<details>` disclosure: Chromium skips styles for closed `<details>` content, so a keyframe never restarts after the first open. Their chevrons snap too, because the content they announce snaps open.
- Card hover shadows: they switch instantly, since `box-shadow` isn't animated.
- Date-picker month changes: they are keyboard driven.
- Payment or check-in success: no spinners and no celebration (visual spec 12.2). The one exception is the quiet arrival of newly issued tickets above, and it runs only once the server has recorded `fulfilledAt`.

The skeleton pulses only when motion is allowed.

## Design sync

- `.design-sync/` syncs `components/ui/` to the Claude design project as component cards (`.design-sync/config.json`: `srcDir`, `docsMap`, previews in `.design-sync/previews/`). `.design-sync/NOTES.md` records how to run it and its risks; `.design-sync/conventions.md` lists the classes and tokens the design agent may use.
- CSS is compiled first by `node .design-sync/build-css.mjs`. `.design-sync/overrides/source-kit.mjs` drops any `components/ui/*` file importing `next/*` (so `FilterBar`, `LinkTabs`, `Count` are not synced).
- Visual spec section 16.4 lists the implemented primitives; update it with a new primitive.
- After a token or primitive restyle, re-run the sync and spot-check components: grades follow preview sources, not styling.

## Impeccable

The Impeccable design skill (`.claude/skills/impeccable/`) reads two root files. Neither is an authority.
- `PRODUCT.md` summarises the PRD for design tools; the PRD wins, so change it first and then the summary.
- `DESIGN.md` and its sidecar `.impeccable/design.json` are generated from the shipped code by `/impeccable document`. They record what is built. The visual spec and this note own intent, and visual spec 16.8 lists the built values kept on purpose, and any other difference is drift to register, not a new rule. Regenerate both after a token or primitive change.
- Its design-check hook is per developer (`.claude/settings.local.json`, ignored). Its binary downloads on first run, so its binary folder is git-ignored.
- Use its review commands (`critique`, `audit`, `clarify`, `harden`, `polish`) on a named page. Don't ask it to "redesign": that treats the current look as something to replace and rewrites `DESIGN.md`.

## Traps

- In an event's Orders tab the sidebar highlights Orders, because that tab is the orders list filtered to the event.
- A new `components/ui/*` file that imports `next/*` silently drops out of design sync.
- Don't add a second `h1`, a second switcher, or a permanent live region.
- Don't style status words in a page; add them to `StatusBadge`.

## Related

[[UI Page Patterns]] · [[Frontend and Backend Flow]] · [[Accessibility Review]] · [[Authentication and Dashboard Access]] · [[Stripe Payments and Connect]] · [[Event Lifecycle]] · [[Memberships and Merchandise]] · [[Society Profiles and Assets]]
