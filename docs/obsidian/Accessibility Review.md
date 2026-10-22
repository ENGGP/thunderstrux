---
status: living
last-reviewed: 2026-10-23
owner: engineering
related: ["[[UI Architecture Rules]]", "[[Route Security Inventory]]", "[[Engineering Delivery Workflow]]"]
sources: [tests/e2e/accessibility.spec.ts, app/layout.tsx, components/ui/responsive-table.tsx, components/purchases/money-summary.tsx, components/settings/staff-management.tsx]
---

# Accessibility Review

The target is WCAG 2.2 AA (T40). This note records what is checked automatically, what was found and fixed, and what still needs a person.

## Checked on every browser campaign

`tests/e2e/accessibility.spec.ts` runs axe (`@axe-core/playwright`, rules tagged WCAG 2.0, 2.1 and 2.2 A and AA) on every journey for its role:

- **Public:** home, Explore events, an event page, Societies, a society's page, memberships and shop, sign-in, sign-up, password reset and guest recovery.
- **Member:** overview, My tickets, Purchases and a ticket purchase, My memberships and a membership order, Societies, Account settings, and an event checkout.
- **Organiser:**
  - the overview;
  - events: list, new, Summary, Edit and Attendees;
  - Calendar in month, week and agenda;
  - Orders and an order;
  - Analytics and History;
  - memberships: plans, a plan, Members and a member;
  - merchandise: products, a product, Pickups and an order;
  - settings: Society profile, Staff, Payments and Email delivery.

Each page is scanned at 390, 768 and 1280px, and at 640px, which is 1280px zoomed to 200%. It must also reflow without sideways scrolling at 320px. The same spec checks the keyboard:

- the first Tab reaches **Skip to content**, which moves focus to the page's `main`;
- a confirmation dialog opened from the keyboard takes focus, closes on Escape and does nothing.

## Found and fixed (23 Oct 2026)

| Finding | Where | Fix |
| --- | --- | --- |
| No way to skip the header and sidebar (2.4.1) | Every page | A Skip to content link, shown on focus, jumps to `main` (`id="main"`, `tabIndex={-1}` on every page's main) |
| A paragraph inside a definition list (1.3.1) | Checkout and receipt summaries (`MoneySummary`) | The note sits after the list |
| Wide tables that scroll sideways couldn't be reached by keyboard (2.1.1) | Every `ResponsiveTable` (Analytics, Orders, Members and others); event Summary's ticket table; Staff; Analytics' Who took part | The scroll area is a focusable region named after its table |
| The page scrolled sideways on phones and at 200% zoom (1.4.10) | Staff settings | The outer grid lets its cards shrink; the tables scroll inside them |

Public journeys had no findings.

## Already in place

- Labels sit in `<label>`; hints and errors are tied with `aria-describedby`, and errors set `aria-invalid`.
- The focus ring is unlayered, so no utility removes it.
- Results are `Notice`s with `role="status"` or `role="alert"`.
- Dialogs are native `<dialog>`: `showModal()` traps focus and Escape cancels.
- Every chart has a table with the same numbers, and the calendar's agenda lists what the grids show.
- Controls are at least 44px tall.
- `prefers-reduced-motion` shortens transitions.
- The date picker works from the keyboard.

## Still needs a person

Scans and scripted keyboard checks don't prove that real people can use the product. These are open for the pilot (T44):

- a screen-reader pass with NVDA and Chrome, and with VoiceOver on iOS, through sign-up, an event checkout (member and guest), My tickets, check-in on a phone, creating and publishing an event, and a refund;
- browser zoom at 200% and 400% on a real desktop, and text spacing overrides;
- colour contrast in states the scans can't trigger (hover, disabled, focus on coloured backgrounds).
