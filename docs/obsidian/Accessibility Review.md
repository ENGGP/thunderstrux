---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[UI Architecture Rules]]", "[[Engineering Delivery Workflow]]", "[[Frontend and Backend Flow]]"]
sources: [tests/e2e/accessibility.spec.ts, app/layout.tsx, app/globals.css, components/ui/confirm-dialog.tsx, components/ui/responsive-table.tsx, components/ui/input.tsx, components/analytics/bar-chart.tsx, scripts/run-e2e.mjs]
---

# Accessibility Review

**Owns:** the accessibility target, what is checked automatically, the rules the UI follows to meet it, and what still needs a person.
**Read when:** adding a page or control, changing a primitive, or updating axe or Playwright.
**Not here:** the primitives and patterns themselves ([[UI Architecture Rules]]); when a browser campaign is required ([[Engineering Delivery Workflow]]); fixed findings ([[Resolved Defects]] and the evidence ledger in `docs/obsidian/History/`).

Target: WCAG 2.2 AA (T40).

## Code

| Concern | Where |
| --- | --- |
| Scans and keyboard checks | `tests/e2e/accessibility.spec.ts` |
| Runs in | the `browser` step of `node scripts/run-e2e.mjs` (with the other browser specs) |
| Findings output | `test-results/a11y-public.json`, `a11y-member.json`, `a11y-organiser.json` (findings and overflow per page) |
| Skip link, `main` target | `app/layout.tsx` |
| Focus ring, reduced motion | `app/globals.css` |

## Checked automatically

- **Engine:** axe via `@axe-core/playwright`, tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`. Any violation fails the test.
- **Widths:** each page is scanned at 390, 768 and 1280px, and at 640px (1280px zoomed to 200%). At those widths and at 320px the page must not scroll sideways (`scrollWidth` within the viewport).
- **Public journeys:** `/`, `/events`, an event page, `/societies`, a society page with its memberships and merchandise tabs, `/login`, `/signup`, `/forgot-password`, `/guest/recover`.
- **Member journeys:** `/dashboard`, `/tickets`, `/purchases` and a ticket purchase, `/memberships` and a membership order, `/dashboard/organisations`, `/account/settings`, and an event checkout.
- **Organiser journeys (owner):** overview; events list, new, Summary, Edit, Attendees; Calendar in month, week and agenda; Orders and an order; Analytics; History; membership plans, a plan, Members and a member; merchandise products, a product, Pickups and an order; Society profile, Staff, Payments, Email delivery.
- **Keyboard:** the first Tab on `/` reaches **Skip to content** and Enter moves focus to `main`; on `/dashboard/events` a confirmation opened from the keyboard (More, Unpublish) takes focus, closes on Escape and changes nothing.

A new page joins the matching journey list in the spec.

## Rules the UI follows

- **Skip link:** every page's `<main id="main" tabIndex={-1}>` is the Skip to content target.
- **Labels:** each control has a `<label>` holding only its label; hints and errors are tied with `aria-describedby`; an error sets `aria-invalid` (`components/ui/input.tsx`, `components/ui/date-field.tsx`).
- **Label in name (2.5.3):** a button whose accessible name adds context starts with its visible words and adds the rest as screen-reader text ("Check in" + name, "Mark ready" + " for order ABC123"). Hidden text inside a scrolling table needs a `relative` button, or it escapes the scroll area and widens the page.
- **Focus:** the ring is an unlayered 2px `--ts-focus` outline that no utility removes.
- **Live regions:** results are `Notice`s with `role="status"` or `role="alert"`; nothing permanent on a page is a live region.
- **Dialogs:** native `<dialog>` via `showModal()` traps focus; Escape cancels and never confirms.
- **Scrolling content:** a container that scrolls sideways is a focusable region named after its content (`role="region"`, `tabIndex={0}`, `aria-label`), as `ResponsiveTable` does; page grids use `grid-cols-1` so wide tables scroll inside their card.
- **Charts and grids:** a chart's accessible name lists every value (`components/analytics/bar-chart.tsx`); the calendar's agenda lists what the grids show.
- **Definition lists** hold only `dt`/`dd` pairs; notes go after the list.
- **Target size:** default controls are 44px (`Button` `md`, link tabs `min-h-11`); compact controls are smaller: `Button size="sm"` is 36px (`h-9`) and filter pills are 40px (`min-h-10`). Both clear WCAG 2.2 AA's 24px minimum.
- **Motion:** `prefers-reduced-motion` shortens transitions.
- **Date picker:** fully keyboard operable ([[UI Architecture Rules#Primitives]]).
- **Link names** are unique on a page (the header owns `Explore events` and `Explore societies`).

## Still needs a person

Scans and scripted keys don't prove real people can use the product. Open for the pilot (T44):

- a screen-reader pass with NVDA and Chrome, and VoiceOver on iOS, through sign-up, an event checkout (member and guest), My tickets, check-in on a phone, creating and publishing an event, and a refund;
- browser zoom at 200% and 400% on a real desktop, and text-spacing overrides;
- colour contrast in states scans can't trigger (hover, disabled, focus on coloured backgrounds).

## Traps

- An axe or Playwright upgrade can add rules (axe-core 4.14 added `label-content-name-mismatch`); it needs a browser campaign before merge ([[Engineering Delivery Workflow]]).
- Screen-reader-only text positioned outside a non-`relative` control escapes `overflow` containers and causes sideways scroll at 768px.

## Related

[[UI Architecture Rules]] · [[Frontend and Backend Flow]] · [[Engineering Delivery Workflow]] · [[Resolved Defects]]
