---
status: living
last-reviewed: 2026-10-28
owner: engineering
related: ["[[UI Architecture Rules]]", "[[Frontend and Backend Flow]]", "[[Accessibility Review]]"]
sources: [app/(dashboard)/dashboard/society-overview.tsx, app/(dashboard)/dashboard/personal-overview.tsx, components/events/event-tabs.tsx, components/events/event-actions.tsx, components/events/create-event-form.tsx, components/events/public-event-view.tsx, components/events/public-ticket-purchase.tsx, components/purchases/checkout-action.tsx, components/purchases/phone-action-bar.tsx, components/organisations/society-header.tsx]
---

# UI Page Patterns

**Owns:** how particular pages are laid out and behave: the overviews, the event workspace, the public event page and buy box, the checkout state screens, the society pages, and the orders and lists screens.
**Read when:** changing one of those pages, or building a page like them.
**Not here:** tokens, primitives, shells, header and footer, motion and the shared patterns every page follows ([[UI Architecture Rules]]); which page lives where, its guard and data ([[Frontend and Backend Flow]]).

## Overview content

- **Member** (design round C1): `Complete your profile` (links to Account settings) until onboarding is done; **Your next plans**, the next event with a valid ticket (paid order, `active` ticket, not ended) and View tickets; Also coming up (next three); Recent purchases (three newest across families, with the buyer's badge or pickup state); Your memberships (active and upcoming, noting one ending within 14 days doesn't renew); Societies you've joined with upcoming public event counts. No metric tiles. A checkout still confirming is a purchase, never a ticket. The two columns stack independently.
- **Society:** header names the society, its zone and today. **Needs your attention** lists only tasks the viewer can act on (`lib/organisations/overview.ts` reads each only for a role holding its permission): setup (payments `stripe:manage`, profile `organisation:settings`, first event `events:manage`), open payment reviews (`orders:read`), merchandise to prepare (`merchandise:fulfil`), memberships ending within 7 days (`members:read`), failed business emails (`orders:email_resend`), drafts starting within 7 days (`events:manage`). Titled `Get {society} ready` while only setup remains, `All caught up` when empty. Tiles: Upcoming events; Sales this month (since the 1st in the society zone, all families) for finance roles or tickets issued for event managers; Members now with `members:read`. Then Upcoming events (Open calendar) and Recent orders across families (`orders:read`; pending ticket orders and ungranted memberships unlinked). Phones: attention, then events, then tiles.
- **Check-in staff** land on **Today at the door**: Events today in the society zone with valid and checked-in counts and Open check-in, then Later this week. No money, orders, drafts or members.

## Event workspace

- `EventWorkspaceHeader` gives every page of one event the same breadcrumb, title, status and selling badge (Sales open, Sold out, Sales closed), dates in the society zone, place, sales close time and actions. Tabs: Summary (`analytics:read`), Attendees (`tickets:check_in`), Orders (`orders:read`; the orders list filtered to the event, accessible name `Orders for this event`), Edit (`events:manage`), Preview (`events:manage`, drafts only). Tabs hide when only one would show. Edit is titled `Edit event` with the event as a breadcrumb. Without `events:manage` a published event shows View public page.
- `EventActions`: Publish, Edit and a `More` menu (native popover so a scrolling table can't clip it) with View public page, Close or Reopen sales, Unpublish and Delete event. A disabled action shows the server's reason (Publish: the first readiness blocker). Publish and Unpublish send the target status and the loaded version; Unpublish and Delete confirm. The API still enforces every rule; the page refreshes after a change.
- Event form (`components/events/create-event-form.tsx`): cards Details (optional 16:9 image), Schedule (times in the society zone, named; sales close shows the start until changed), Tickets (`$` price, quantity, sold and held per type), Access (Public or Link only, optional capacity) and If tickets cannot be issued. Sticky save bar: one opaque row at every width, a status line that truncates first ("Unsaved changes", or "Not saved: see above", short enough for a phone), Cancel and Save. A result shows at the top of the form and, when it is a problem, takes focus, which scrolls it into view; the readiness aside sticks below the header (`lg:top-24`). A published event's Edit shows that changes go live on save and holders are emailed only about a new time or place (T30). Rules: [[Event Lifecycle]].
- Attendees: the check-in console ([[Ticket Check-in Implementation]]); its search field takes focus on arrival, so the door starts with search even below the header.

## Public event page and buy box

- `PublicEventView` (`components/events/public-event-view.tsx`) is shared with the organiser's draft preview: 16:9 image, society link, title, date range with zone, location, About, Hosted by with support email and refund policy when set. Below `lg` the ticket box comes before Hosted by; from `lg` it sits in the right column.
- Buy box (`components/events/public-ticket-purchase.tsx`): "Prices in AUD"; each type's price or Free and "N left", Sold out or "Paid tickets unavailable right now"; a Sales closed or Sold out badge replaces the choices when nothing can be bought. One ticket choice, one `Quantity` ("Up to 10 per order"), then `Get free tickets`, `Get tickets` or `Continue as guest` (UX spec 5.4) with the running total, opening the checkout page. The action follows the viewer (sign in, verify email, society account, buy). Below `lg`, while the box's button is off screen, the phone action bar repeats the selection and action; hidden for society and unverified viewers. Quantity takes whole numbers only; an impossible one says "Choose 1 to N" under the field and the total row stays (showing "–"), so nothing jumps. The hint gives the real limit (the fewer of 10 and what's left). Pressed, the action reads "Opening…" at its own width.

## Checkout state screens

The checkout page (`components/purchases/checkout-action.tsx`) shows tickets and total ("Free" and "No payment needed." for free; "No booking fee" for paid), who the tickets go to, the 30-minute hold for paid tickets, and the refund policy and support email when set. The action is `Confirm free registration` or `Pay A$X.XX` (`payLabel`, `lib/format.ts`; membership and merchandise checkouts too); it sends the price shown and one idempotency key per reviewed quote, and any server answer ends that key. A 202 shows `Confirming checkout...` while it polls the attempt for up to 30 seconds.

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

Any other failure keeps the button and shows a danger `Notice` with `Change tickets`. An unverified member sees `Verify your email to continue` instead of the action. Guests see "Where should we send your tickets?" (steps Your email, Review, Pay with Stripe) with required First name and Last name, which door staff search by, then "Check your email", then the review showing "Buying as a guest". `tests/e2e/checkout-states.spec.ts` drives the refusals and checks 390 and 1280px for sideways scroll. Below `lg` the phone action bar repeats the total and Pay while the page's Pay button is below the screen (ticket, membership and merchandise checkouts); a refusal screen hides it. A refusal screen takes focus when it replaces the Pay button; a generic error and "Confirming your checkout…" sit under the button. Back from Stripe resets a busy button (`pageshow`). Not built from the mobile artboard: a struck-through old total.

## Society pages

`SocietyHeader` is the same on every tab, so the tabs never move: a short cover (3:1, 5:1 from `md`; a quiet line pattern when there is none), the logo over its edge, the name, and a badge row kept even when empty, so joining adds a badge without moving the page. Tabs: Overview, and Memberships and Merchandise when there is something to show. Every tab uses the same `SocietyJoinCard` (heading, one line on what joining means, the action, contact). Sign-in or verification never joins automatically. Overview then lists Upcoming events, a Membership preview (the soonest plan still to end: name, dates, price, "No automatic renewal") and a Merchandise preview (the four newest products, Pickup only), each only when there is something to show and each linking to its tab, then Policies (refund and pickup), so events come before reference reading on a phone; Overview has no buy buttons.

## Lists and orders

- Orders: tickets, memberships and merchandise share one table shape (buyer and reference, items, total, payment, pickup for merchandise, time). Pending ticket rows are shown only under "Show system orders" and are never linked; pending is not a product status.
- Order detail: breadcrumb `Orders`, title `Order` plus the short reference, status badge. The ticket line uses the purchased ticket name; an order from before T10 shows today's name with "(historical label unavailable)". A Summary card and a `Manage this order` card (resend, refund, record an outside refund through `ConfirmDialog`, verify a compensation refund id, Stripe session with copy and link). `Order history` sits in exactly one `<section>`; browser tests locate it that way.
- Memberships: plans table from 768px with Runs in the society zone, Price or Free, a status (Draft, Published, Ended, Archived) and holders. Plan form: Term (Semester 1, Semester 2, Full year or Custom dates), Details, Price with the fee example, What it unlocks. Member page actions each confirm, ask for a reason and the authenticator code; a refund dialog names the amount and asks for the order's short reference.
- Staff settings: invite with email and `Invitation role` (hint says what the role can do); role changes and revocations confirm; pending invitations and a separate history table; owners also see `Committee handover`.


## Related

[[UI Architecture Rules]] · [[Frontend and Backend Flow]] · [[Accessibility Review]] · [[Event Lifecycle]] · [[Memberships and Merchandise]] · [[Society Profiles and Assets]]
