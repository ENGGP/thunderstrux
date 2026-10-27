---
name: Thunderstrux
description: Events, tickets, memberships and merchandise for student societies.
colors:
  brand: "#5b2acb"
  brand-hover: "#4c22af"
  brand-ink: "#2a1550"
  brand-tint: "#f0eafe"
  brand-200: "#dccffa"
  ink: "#24143b"
  ink-soft: "#594f67"
  ink-muted: "#6b6276"
  paper: "#fbfafd"
  warm-paper: "#fcfaf5"
  surface: "#ffffff"
  surface-subtle: "#f5f2fa"
  line: "#ddd6e7"
  line-strong: "#9e8aac"
  focus: "#1e72d8"
  success: "#0b6b55"
  success-bg: "#eef8f4"
  success-border: "#bfe3d6"
  success-icon: "#12866a"
  warning: "#8a4a06"
  warning-bg: "#fdf5e7"
  warning-border: "#f1d9ae"
  warning-icon: "#b5650c"
  danger: "#a61e3f"
  danger-bg: "#fdf1f3"
  danger-border: "#f4c6d0"
  danger-icon: "#c42d4f"
  info: "#4a4360"
  info-bg: "#f7f5fb"
  info-border: "#e3ddee"
  neutral: "#595265"
  neutral-bg: "#f3f1f6"
  neutral-border: "#e2dde9"
  neutral-icon: "#8e869b"
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
    backgroundColor: "{colors.brand-ink}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.brand-ink}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 16px"
  button-secondary-hover:
    backgroundColor: "{colors.brand-tint}"
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
    backgroundColor: "{colors.brand-tint}"
    textColor: "{colors.brand-ink}"
    rounded: "{rounded.control}"
  org-sidebar:
    backgroundColor: "{colors.brand-ink}"
    textColor: "{colors.surface}"
    width: "244px"
---

# Design System: Thunderstrux

> **Generated from the shipped code** (`app/globals.css`, `components/ui/`, `components/layout/`, `components/events/`, and computed styles on the dev app) by `/impeccable document` on 2026-10-28. It records what is built, not what is intended. Intent lives in the [visual design specification](docs/THUNDERSTRUX_COMPLETE_VISUAL_DESIGN_SPEC.md) and [UI Architecture Rules](docs/obsidian/UI%20Architecture%20Rules.md); they win on any conflict (visual spec 16.8 lists the built values kept on purpose), and any other difference is drift to register, not a new rule. Regenerate it after a token or primitive change.

## Overview

**Creative North Star: "The Campus Edition"**

A student culture magazine, a polished ticket window and an operations desk sharing one purple-first system. In the built product the magazine shows in the public pages: a deep-plum hero on the home page, Space Grotesk headings, the date rail on every event card, and a 3px brand rule under the current tab and section titles. The ticket window is quieter: white surfaces, hairline borders, one purple action. The desk is the organiser shell: a 244px deep-plum navigation column beside dense, neutral pages.

The system is light-only, flat and hairline-led. Depth is a border, not a shadow; shadows appear only on hover for event cards and on floating panels. Motion is small and earned: menus and dialogs pop in, phone sheets slide, freshly issued tickets rise in once, and everything else stays still.

**Key Characteristics:**
- Purple carries actions, current state and identity; status colours carry meaning and never decorate.
- Two typefaces: Space Grotesk for `h1`/`h2` and display, DM Sans for everything else.
- Four named radii (6, 9, 14, 20px); no generic `rounded-md/lg/xl`.
- Every surface is opaque; no gradients except the striped image placeholder.

## Colors

A violet brand on lavender-tinted paper, with jade, ochre and crimson reserved for status.

### Primary
- **Campus Violet** (`brand`): primary buttons, text links, the active-tab rule, the active nav marker and focus family. Hover deepens to **Pressed Violet** (`brand-hover`), active to **Midnight Plum** (`brand-ink`).
- **Midnight Plum** (`brand-ink`): the home hero block, the organiser navigation column, active tab and pill text.
- **Lilac Wash** (`brand-tint`) and **Lilac Outline** (`brand-200`): date rail, active pills, accent badges, the image placeholder.

### Neutral
- **Ink** (`ink`), **Soft Ink** (`ink-soft`), **Muted Ink** (`ink-muted`): body, secondary and tertiary text.
- **Lavender Paper** (`paper`): the page canvas. **Warm Paper** (`warm-paper`): two editorial sections on the home page. **Surface** (`surface`): cards, forms, tables. **Subtle Surface** (`surface-subtle`): disabled fields, counts, row tints.
- **Hairline** (`line`): every default border (the base layer sets it, so a bare `border` is a hairline). **Control Edge** (`line-strong`): input and secondary-button borders.
- **Focus Blue** (`focus`): the 2px keyboard ring, deliberately not purple.

### Status roles
Success (jade), warning (ochre), danger (crimson), info (lilac-grey with a brand icon) and neutral each come as text, `-bg` wash, `-border` hairline and `-icon` mark. Text is at least 6:1 and icons at least 3:1 on their own wash.

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

Named containers set every page width: auth 440px, read 760px, checkout 1060px, personal 1160px, page 1248px, admin 1420px. The fixed header is 60px (72px from `md`) and the layout offsets content by the same amount. Public pages stack sections 32–64px apart; the home page 56px on phones and 80px from `md`, under a hero with 56–80px vertical padding. The organiser shell is a two-column grid from `lg` (244px column plus the page); below `lg` the column collapses to the society name and a `Society menu` disclosure. Wide tables become cards below 768px (`ResponsiveTable`); tab bars scroll sideways instead of wrapping. The public event page is two columns from `lg` with the ticket box on the right, and a phone buy bar slides up when the box is off screen.

## Elevation & Depth

Flat by default: surfaces separate by tone (paper vs surface) and hairlines. Two shadows exist and both are conditional.

### Shadow Vocabulary
- **Card hover** (`box-shadow: 0 4px 18px rgba(36,20,59,.055)`): event cards on hover only, switching instantly.
- **Float** (`box-shadow: 0 14px 44px rgba(36,20,59,.12)`): the event More menu, the navbar menu, the confirm dialog and the phone buy bar.

### Named Rules
**The Flat-At-Rest Rule.** Nothing casts a shadow at rest except something floating above the page.

## Shapes

Moderately squared: 6px tags and badges, 9px controls and buttons, 14px cards and notices, 20px for editorial feature panels (the home page and the society cover). Pills and avatar dots are fully round. The active tab and active nav item carry a 3px brand edge (bottom and left respectively). Images are 16:9 and bleed to the card edge; with no image, a lilac block with a faint 135° stripe stands in.

## Components

### Buttons
- **Shape:** gently squared (9px).
- **Primary:** Campus Violet fill, white 14px semibold label, 44px tall (36px `sm`, 48px `lg`).
- **Hover / Focus / Press:** colour cross-fades over 150ms; press scales to 97%; focus is the blue 2px ring with a 2px offset.
- **Secondary:** white with a Control Edge border and Midnight Plum label, lilac wash on hover. **Tertiary:** a brand text link that underlines on hover. **Danger:** crimson outline; solid crimson only on a dialog's confirm button.
- **Disabled:** neutral wash, neutral border, muted text.

### Chips (pills and badges)
- **Status badge:** 24px, 6px radius, wash + hairline + coloured dot + word, 12px semibold.
- **Filter pills:** 40px, fully round; active is lilac wash with a brand border and plum text. Counts sit in a small 6px-radius chip.

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** white on lavender paper.
- **Shadow Strategy:** none at rest (see Flat-At-Rest).
- **Border:** hairline.
- **Internal Padding:** 20px, 24px from `sm`.

### Inputs / Fields
- **Style:** 44px, 9px radius, Control Edge border, white fill, 16px text; the label sits above in 14px semibold, hint and error below in 14px.
- **Focus:** the global blue ring. **Error:** crimson border plus a crimson message tied by `aria-describedby`. **Disabled:** subtle surface.

### Navigation
- **Header:** white, 60/72px, brand wordmark left; links in Soft Ink, the current one in Ink with a 3px brand rule on the header's bottom edge. Below `md` the links fold into a `Menu` disclosure.
- **Tabs:** 44px tall, 15px; active is semibold Midnight Plum over a 3px brand underline on a 1px hairline track.
- **Organiser column:** Midnight Plum, white text, group labels at 70% white, 36px rows from `lg` with a 3px left marker on the current item.

### Event card
- **Order:** 16:9 image (or a striped lilac area from `sm` when a neighbour has an image), date rail, host link, title, date, place, then the selling line.
- **Selling line:** the standard prices on sale in semibold ink ("Free", "$12.00", "From $12.00", "Free or $15.00"), or a Sold out or Sales closed badge, or "Paid tickets unavailable right now" in Soft Ink.

### Date rail (signature)
A lilac tile with the day in Space Grotesk and the three-letter month in 12px uppercase, both Midnight Plum, leading every event card and list. It anchors "what's happening" before the title.

### Notice
A 14px-radius toned panel: wash, hairline, 20px icon, toned title, ink body, optional action on the right and a close button when dismissible.

## Do's and Don'ts

### Do:
- **Do** use the semantic utilities (`bg-brand`, `text-ink-soft`, `border-line`, `rounded-card`, `max-w-page`) for every colour, radius and width.
- **Do** keep one purple primary action per area; use secondary or tertiary for the rest.
- **Do** show every status through `StatusBadge` or `Notice`, with its word.
- **Do** keep check-in, list rows, tab changes and payment results still; animate only menus, dialogs, phone sheets and newly issued tickets.

### Don't:
- **Don't** use raw palette classes (`bg-neutral-900`, `text-purple-600`) or hex values in components.
- **Don't** use `rounded-md`, `rounded-lg` or `rounded-xl`; use the four named radii.
- **Don't** add a dark mode, an icon library or a shadow at rest.
- **Don't** use status colours or a society's own colours for buttons, payment or security cues.
