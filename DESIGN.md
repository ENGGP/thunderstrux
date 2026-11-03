---
name: Thunderstrux
description: Events, tickets, memberships and merchandise for student societies.
colors:
  brand: "#5b2acb"
  brand-hover: "#4c22af"
  brand-ink: "#2a1550"
  brand-tint: "#ece4ff"
  brand-200: "#dccffa"
  night: "#33136c"
  night-raised: "#44207f"
  night-stripe: "#4a2394"
  glow: "#bda6ff"
  ink: "#24143b"
  ink-soft: "#594f67"
  ink-muted: "#6b6276"
  paper: "#f3f0f8"
  surface: "#ffffff"
  surface-subtle: "#f9f7fc"
  inert: "#f0eff2"
  line: "#d8cfe5"
  line-strong: "#8d79a0"
  focus: "#24143b"
  chart-2: "#8b72e8"
  chart-out: "#8a8296"
  success: "#0b6b55"
  success-bg: "#e6f5ee"
  success-border: "#a9dcc8"
  success-icon: "#12866a"
  warning: "#8a4a06"
  warning-bg: "#fdf1dc"
  warning-border: "#eccf95"
  warning-icon: "#b5650c"
  danger: "#8f0d31"
  danger-bg: "#fdecf0"
  danger-border: "#e3a1b2"
  danger-icon: "#c42d4f"
  info: "#4a4360"
  info-bg: "#eeebf3"
  info-border: "#d6cfe0"
  neutral: "#595265"
  neutral-bg: "#f3f1f6"
  neutral-border: "#e2dde9"
  neutral-icon: "#8e869b"
  on-brand: "#ffffff"
  subtle-edge: "#b7a3f4"
  go: "#0b6b55"
  go-text: "#ffffff"
  stop: "#9e122f"
  stop-stripe: "#6c0a1f"
  stop-text: "#ffffff"
  hold: "#f4cc64"
  hold-text: "#24143b"
typography:
  display:
    fontFamily: "Space Grotesk, DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "3.75rem"
    fontWeight: 600
    lineHeight: 1.06
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Space Grotesk, DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "3rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.01em"
  page-title:
    fontFamily: "Space Grotesk, DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  section:
    fontFamily: "Space Grotesk, DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "-0.01em"
  title:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.55
  body:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  ui:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 500
  label:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
  caption:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
rounded:
  tag: "6px"
  control: "9px"
  card: "14px"
  feature: "20px"
spacing:
  card-sm: "20px"
  card: "24px"
  section: "32px"
  hero: "64px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.brand-hover}"
  button-primary-active:
    backgroundColor: "{colors.night}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.brand-ink}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 16px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-subtle}"
  button-quiet:
    textColor: "{colors.ink-soft}"
    height: "44px"
  button-subtle:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.brand-hover}"
    rounded: "{rounded.control}"
    height: "44px"
  button-danger-text:
    textColor: "{colors.danger}"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    height: "44px"
  button-sm:
    height: "36px"
    padding: "0 12px"
  button-lg:
    height: "48px"
    padding: "0 20px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 12px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "24px"
  status-badge:
    rounded: "{rounded.tag}"
    height: "24px"
    padding: "0 8px"
  tab-active:
    textColor: "{colors.brand-ink}"
  pill-active:
    backgroundColor: "{colors.brand-tint}"
    textColor: "{colors.brand-ink}"
    height: "40px"
  date-rail:
    backgroundColor: "{colors.night}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    size: "68px"
  door-band:
    height: "72px"
    typography: "24px bold Space Grotesk"
  org-sidebar:
    backgroundColor: "{colors.night}"
    textColor: "{colors.surface}"
    width: "244px"
---

# Design System: Thunderstrux

> **Generated from the shipped code** (`app/globals.css`, `components/ui/`, `components/layout/`, `components/events/`, and computed styles on the dev app) by `/impeccable document` on 2026-10-28, and brought to the night violet palette and its status, door and money rules (round G, PRs 1 and 2) on 2026-11-03. It records what is built, not what is intended. Intent lives in the [visual design specification](docs/THUNDERSTRUX_COMPLETE_VISUAL_DESIGN_SPEC.md) and [UI Architecture Rules](docs/obsidian/UI%20Architecture%20Rules.md); they win on any conflict (visual spec 16.8 lists the built values kept on purpose), and any other difference is drift to register, not a new rule. Regenerate it after a token or primitive change.

## Overview

**Creative North Star: "The Campus Edition"**

A student culture magazine, a polished ticket window and an operations desk sharing one purple-first system. In the built product the magazine shows in the public pages: a night violet hero on the home page with one glow word and the soonest event as a ticket stub, Space Grotesk headings, the night date tile on every event card, and a 3px brand rule under the current tab. The ticket window is quieter: white surfaces, hairline borders, one purple action. The desk is the organiser shell: a 244px night violet navigation column beside dense, neutral pages.

The system is light, flat and hairline-led; only the door has a dark mode. Depth is a border, not a shadow; shadows appear only on hover for event cards and on floating panels. Motion is small and earned: menus and dialogs pop in, phone sheets slide, a result eases open under the action that caused it, freshly issued tickets rise in once, and everything else stays still.

**Key Characteristics:**
- Violet has three jobs: night violet owns surfaces, action violet marks the one thing to do, selected lilac marks what you chose. Status colours carry meaning and never decorate.
- Two typefaces: Space Grotesk for `h1`/`h2` and display, DM Sans for everything else.
- Four named radii (6, 9, 14, 20px); no generic `rounded-md/lg/xl`.
- Every surface is opaque; no gradients except the placeholder's one stripe and the hatched money-out bars in charts.

## Colors

Night violet on a lavender canvas, with jade, ochre and crimson reserved for status.

### Primary
- **Night Violet** (`night`): owns surfaces. The home hero, the organiser navigation column, the date tile, image placeholders. The brand mark and app icons are the owner's own mark: a bolt in Campus Violet and Plum Ink on a lavender `#f0eafe` tile. **Night Raised** (`night-raised`) marks the current nav item and holds the workspace select; **Glow** (`glow`) is its accent and appears only on night (one hero word, the nav marker, the date tile's month, placeholder initials).
- **Campus Violet** (`brand`): the one thing to do. Primary buttons, action links and links inside a sentence, the active-tab rule, today's mark and the calendar's now line. Hover deepens to **Pressed Violet** (`brand-hover`), press to Night Violet.
- **Selected Lilac** (`brand-tint`) and **Lilac Outline** (`brand-200`): what you chose. Active pills and segments, published calendar chips, accent badges; an interactive selection always carries a brand edge.
- **Plum Ink** (`brand-ink`): active tab and secondary-button text.

### Neutral
- **Ink** (`ink`), **Soft Ink** (`ink-soft`), **Muted Ink** (`ink-muted`): body, secondary and tertiary text. Row titles and utility links are ink (`rowLinkClasses`, `quietLinkClasses`), turning violet on hover.
- **Lavender Canvas** (`paper`): the page canvas, 1.13:1 against white so cards lift off it. **Surface** (`surface`): cards, forms, tables. **Inset** (`surface-subtle`): table heads, counts and row tints inside a card. **Inert Grey** (`inert`): disabled fields, grey so they never read as selected.
- **Hairline** (`line`): every default border (the base layer sets it, so a bare `border` is a hairline). **Control Edge** (`line-strong`): input and secondary-button borders, 3.9:1 on white.
- **Ink Ring** (`focus`): the 2px keyboard ring with a 2px white gap; `surface-night` turns it white with a night gap.

### Status roles
Success (jade), warning (ochre), danger (crimson), info (slate, in the neutral family, so purple stays out of notices) and neutral each come as text, `-bg` wash, `-border` hairline and `-icon` mark. Text is at least 5.7:1 and icons at least 3:1 on their own wash.

### Door verdicts
The check-in door reads at arm's length in a bright or dark room, so its decisions are solid bands, not washes: **Go** (`go`, jade, white text) for a check-in just made; **Stop** (`stop`, crimson, with `stop-stripe` stripes and white text) for Don't admit and Already checked in; **Hold** (`hold`, ochre, ink text) for Under review and Status unknown. 72px with 24px text on phones. A dark door (Auto follows the phone; Light or Dark is remembered) redeclares the tokens: canvas `#18102a`, card `#261d3e`, text `#f5f4fd`, Check in `#a494f6`, Go `#37d59f`, Stop `#f97770` with `#ffaba6` stripes.

### Charts
Series one is Campus Violet and series two **Chart Lilac** (`chart-2`), stacked with a 2px gap. Money going out is hatched **Chart Grey** (`chart-out`, the `hatch` utility) below the axis with its amount in crimson; on phones it runs left from zero. A cancelled event's bars are Chart Grey.

### Named Rules
**The Status-Only Rule.** Jade, ochre and crimson appear only with a status word or icon (`StatusBadge`, `Notice`), never as decoration or brand.
**The Hairline Default Rule.** Borders default to the hairline token; a stronger edge marks only something you type into or press.

## Typography

**Display Font:** Space Grotesk (with DM Sans, system sans)
**Body Font:** DM Sans (with system sans)

**Character:** a slightly technical, squared grotesk for titles over a friendly geometric sans for reading and data; headings tighten to -0.01em.

### Hierarchy
- **Display** (600, 60px, 1.06 from `md`, 1.1 on phones, balanced wrap): home hero only.
- **Headline** (600, 48px, 1.0): public event and society titles.
- **Page title** (600, 30px): every `PageHeader` `h1` in dashboards, personal pages and forms.
- **Section** (600, 24px): public section `h2`s; a panel's own heading (the buy box, the join card) is 20px.
- **Title** (DM Sans 600, 18px): card and list item headings (`h3`).
- **Body** (400, 16px, 1.55): default text; inputs use 16px so phones don't zoom.
- **UI** (15px) and **Caption** (13px): dense body and meta lines; **Label** (600, 14px) for field labels and buttons.

Tables use tabular figures.

### Named Rules
**The Two-Voice Rule.** Space Grotesk only on `h1`, `h2` and `font-display` elements such as the date rail numerals; card titles stay DM Sans.

## Layout

Named containers set every page width: auth 440px, read 760px, checkout 1060px, personal 1160px, page 1248px, admin 1420px. The fixed header is 60px (72px from `md`) and the layout offsets content by the same amount. Public pages stack sections 32–64px apart; the home page 56px on phones and 80px from `md`, under a hero with 56–80px vertical padding. The organiser shell is a two-column grid from `lg` (244px column plus the page); below `lg` the column collapses to one row, the society name beside a `Society menu` disclosure. Wide tables become cards below 768px (`ResponsiveTable`); tab bars scroll sideways instead of wrapping, and fade at the edge while more is hidden. The public event page is two columns from `lg` with the ticket box on the right, and a phone buy bar slides up when the box is off screen.

## Elevation & Depth

Flat by default: surfaces separate by tone (paper vs surface) and hairlines. Three shadows exist, each for something above the page or under the pointer.

### Shadow Vocabulary
- **Card hover** (`box-shadow: 0 4px 18px rgba(36,20,59,.055)`): event cards on hover only, switching instantly.
- **Float** (`box-shadow: 0 14px 44px rgba(36,20,59,.12)`): the event More menu, the navbar menu, the confirm dialog and the phone buy bar.
- **Lift** (`shadow-lift`, `0 -8px 24px rgba(36,20,59,.1)`): sticky bottom bars on phones (the purchase action bar, the event form's save bar), so they read as above the page they cover.

### Named Rules
**The Flat-At-Rest Rule.** Nothing casts a shadow at rest except something floating above the page.

## Shapes

Moderately squared: 6px tags and badges, 9px controls and buttons, 14px cards and notices, 20px for editorial feature panels (the home page and the society cover). Pills and avatar dots are fully round. The active tab carries a 3px brand rule; the active nav item a 3px glow left edge on a raised night row. Images are 16:9 and bleed to the card edge; with no image, the night violet `Placeholder` stands in (one lighter stripe, the initial in glow), and in a card grid only when a neighbour has a real photo.

## Components

### Buttons
- **Shape:** gently squared (9px).
- **Primary:** Campus Violet fill, white 14px semibold label, 44px tall (36px `sm`, 48px `lg`).
- **Hover / Focus / Press:** colour cross-fades over 150ms; press scales to 97%; focus is the ink 2px ring with a 2px white gap.
- **Secondary:** white with a Control Edge border and Plum Ink label, inset on hover. **Tertiary:** a brand text link that underlines on hover. **Quiet:** soft ink text for a way out (a dialog's Cancel, Leave society). **Danger:** crimson outline; **Danger text** for a destructive action repeated down a list (Revoke access); solid crimson only on a dialog's confirm button. **Subtle:** a white button with a lilac edge and violet text, for a second action beside the one filled button (Mark ready on phones). **On night:** a white button and a glow-edged ghost (`onNight`, `ghostNight`).
- **Disabled:** neutral wash, neutral border, muted text.
- **Busy:** keeps its colour and its width; the label reads the busy label ("Saving…", "Opening Stripe…") in the same space, with no spinner. Every variant carries a border, transparent where none shows, so no state changes the button's size.

### Chips (pills and badges)
- **Status badge:** 24px, 6px radius, wash + hairline + 14px glyph + word, 12px semibold. The glyph tells families apart without colour: a tick (money moved, admitted), a clock (waiting), a triangle (look at this), a cross (failed, an event called off), a return arrow (money back), a dash (closed), a circle (a normal state), a mark for what is yours, a bag (ready to collect).
- **Filter pills:** 40px, fully round; active is lilac wash with a brand border and plum text. Counts sit in a small 6px-radius chip.

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** white on lavender paper.
- **Shadow Strategy:** none at rest (see Flat-At-Rest).
- **Border:** hairline.
- **Internal Padding:** 20px, 24px from `sm`.

### Inputs / Fields
- **Style:** 44px, 9px radius, Control Edge border, white fill, 16px text; the label sits above in 14px semibold, hint and error below in 14px.
- **Focus:** the global ink ring. **Error:** crimson border plus a crimson message tied by `aria-describedby`. **Disabled:** Inert Grey with a hairline and soft ink text.
- **Quantity stepper:** one Control Edge frame holding 44px − and + buttons around a centred, typable count; an error replaces the hint.

### Navigation
- **Header:** white, 60/72px, brand mark and wordmark left (the mark alone from `md` to `lg`); links in Soft Ink, the current one in Ink with a 3px brand rule on the header's bottom edge. Below `md` the links sit in a `Menu` popover (44px rows, the current page marked with a 3px brand edge); a member's My tickets stays outside it and Sign out moves in.
- **Brand mark:** the owner's mark (`components/ui/brand-mark.tsx`): a lavender `#f0eafe` tile with a two-part bolt in Campus Violet `#5b2acb` and Plum Ink `#2a1550`. It sits beside the `Thunderstrux` wordmark, so it is `aria-hidden`: 28px in the header, 24px in the footer and admin shell. It keeps its own hex colours so the door's dark theme doesn't recolour it; the tile carries it on dark surfaces without a variant. The favicon (`app/icon.svg`, with `app/favicon.ico` at 16, 32 and 48px packed from it) and the home-screen icon (`app/apple-icon.tsx`, a full-bleed tile because iOS rounds the corners) are the same mark. Email has no brand header.
- **Tabs:** 44px tall, 15px; active is semibold Plum Ink over a 3px brand underline on a 1px hairline track.
- **Organiser column:** Night Violet, white text, group labels at 70% white, 36px rows from `lg`. The current item is a Night Raised row with a 3px glow left edge; the workspace select sits on Night Raised with a glow edge.

### Event card
- **Order:** 16:9 image (or the night placeholder with the event's initial, from `sm`, when a neighbour has an image), date tile, host link, title, date, place, then the selling line.
- **Selling line:** the standard prices on sale in semibold ink ("Free", "$12.00", "From $12.00", "Free or $15.00"), or a Sold out or Sales closed badge, or "Paid tickets unavailable right now" in Soft Ink.

### Date tile (signature)
A fixed night violet square (68px in cards, 56px in lists) with the day in white Space Grotesk over the three-letter month in 12px uppercase glow, leading every event card and list. It anchors "what's happening" before the title, and never stretches with the text beside it. A cancelled event's tile is grey.

### Notice
A 14px-radius toned panel: wash, hairline, 20px icon, toned title, ink body, optional action on the right and a close button when dismissible. Anything that stops or changes a purchase is a warning with a real button.

### Ticket face
A band leads the buyer's ticket: the event and its state, night violet while it admits, otherwise the wash of its state. The QR code follows while it admits; a used ticket shows "Used at the door at {time}" instead.

## Do's and Don'ts

### Do:
- **Do** use the semantic utilities (`bg-brand`, `text-ink-soft`, `border-line`, `rounded-card`, `max-w-page`) for every colour, radius and width.
- **Do** keep one filled violet button per view; use secondary, quiet or tertiary for the rest, and quiet ink links for row titles and utility links.
- **Do** show every status through `StatusBadge` or `Notice`, with its word.
- **Do** keep check-in, list rows, tab changes and payment results still; animate only menus, dialogs, phone sheets, a result easing in under its action, and newly issued tickets.
- **Do** show a result directly under the button that caused it, never at the top of the form.

### Don't:
- **Don't** use raw palette classes (`bg-neutral-900`, `text-purple-600`) or hex values in components.
- **Don't** use `rounded-md`, `rounded-lg` or `rounded-xl`; use the four named radii.
- **Don't** add a dark mode outside the door, an icon library or a shadow at rest.
- **Don't** use status colours or a society's own colours for buttons, payment or security cues.
