# Thunderstrux UI conventions

Thunderstrux is a ticketing platform for university societies. Visual identity: purple-first, calm, readable; DM Sans body, Space Grotesk headings.

## Setup
- No provider or wrapper is needed. Components are plain React; load `styles.css` (it imports the tokens and `_ds_bundle.css`) and use `window.Thunderstrux.*`.
- `styles.css` sets `body` to `--ts-paper` background, `--ts-ink` text, DM Sans 16px. Keep `<body>` unstyled, and put page content on `bg-paper` (or `bg-warm-paper` for marketing).
- Fonts load from Google Fonts via `styles.css`; no extra setup.

## Styling idiom: Tailwind utilities backed by `--ts-*` tokens
Use the semantic names below, never raw palette classes (`bg-purple-600`, `text-gray-500`). Only classes already compiled into `_ds_bundle.css` exist, so check that file before inventing a class; for anything missing use `style={{ ... var(--ts-*) }}`.

| Family | Classes |
|---|---|
| Surfaces | `bg-paper` `bg-warm-paper` `bg-surface` `bg-surface-subtle` `bg-brand-tint` |
| Text | `text-ink` `text-ink-soft` `text-ink-muted` `text-brand` `text-danger` `text-success` `text-warning` `text-info` `text-neutral` |
| Brand | `bg-brand` `hover:bg-brand-hover` `bg-brand-ink` `bg-lime` (accent) |
| Status | per role `success` `warning` `danger` `info` `neutral`: text `text-*`, wash `bg-*-bg`, hairline `border-*-border`, icon `text-*-icon`. Warning is for real risk only; drafts and disabled states are neutral |
| Borders | `border` + `border-line` (hairline), `border-line-strong` (controls) |
| Radius | `rounded-tag` 6px, `rounded-control` 9px, `rounded-card` 14px, `rounded-feature` 20px |
| Shadow | `shadow-card`, `shadow-float` (overlays) |
| Type | `font-display` for headings, `font-sans` default; sizes `text-xs`..`text-4xl`; weights `font-medium` `font-semibold` `font-bold` |
| Width | `max-w-auth` 440, `max-w-read` 760, `max-w-checkout` 1060, `max-w-personal` 1160, `max-w-page` 1248, `max-w-admin` 1420 |
| Layout glue | `flex` `grid` `gap-{0-6,8,10,12,16}` `p/px/py/m/mx/my/mt/mb-{0-6,8,10,12,16}` `grid-cols-{1-4}` (+ `sm:` `md:` `lg:`) `items-*` `justify-*` `w-full` `mx-auto` |

Raw tokens: `var(--ts-ink)`, `--ts-ink-soft`, `--ts-ink-muted`, `--ts-brand`, `--ts-brand-hover`, `--ts-brand-ink`, `--ts-brand-tint`, `--ts-paper`, `--ts-surface`, `--ts-surface-subtle`, `--ts-border`, `--ts-input-border`, `--ts-focus`, `--ts-{success,warning,danger,info,neutral}` with `-bg`, `-border` and `-icon`.

## Rules
- Use library components for controls: `Button` (never a styled `<button>`), `TextInput`/`TextArea`/`Select` (they own the label, hint and error wiring; pass `label`, `hint`, `error`), `Notice` for inline messages (optional `action` link), `Skeleton`/`ListSkeleton` while data loads, `Icon` for the outline icon set, `StatusBadge` for server states, `Card` for any bordered surface, `ConfirmDialog` for confirmations.
- Colour never carries meaning alone: statuses and notices always include words. Destructive actions use `Button variant="danger"`; `dangerSolid` only on the confirming button of a `ConfirmDialog`.
- Keyboard focus ring is global (2px `--ts-focus`); do not add `outline-none`.
- Keep copy plain and British ("organisation", "society"). Buttons say what happens ("Buy tickets", "Publish event").

## Where the truth lives
Read `styles.css` and `_ds_bundle.css` before styling, `components/<group>/<Name>/<Name>.d.ts` for props, and `<Name>.prompt.md` for usage. Visual rules in depth: `guidelines/docs/THUNDERSTRUX_COMPLETE_VISUAL_DESIGN_SPEC.md`.

## Example
```jsx
const { Card, TextInput, Select, Button, Notice } = window.Thunderstrux;

<main className="bg-paper min-h-screen p-6">
  <Card className="mx-auto max-w-auth grid gap-4">
    <h1 className="font-display text-2xl font-semibold text-ink">Create an event</h1>
    <Notice tone="info">Events stay in draft until you publish them.</Notice>
    <TextInput label="Event name" placeholder="Spring Ball 2027" />
    <Select label="Ticket type" hint="You can add more later."><option>Standard</option></Select>
    <Button size="lg">Save draft</Button>
  </Card>
</main>
```
