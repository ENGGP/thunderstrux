# design-sync notes

Project: "Thunderstrux UI" — https://claude.ai/design/p/6075c42a-6f43-4f56-8d3c-6554004a550a (17 components from `components/ui/` as of the 2026-10-25 re-sync, all with authored previews).

## How this repo is synced
- Not a published package: no `dist/`, no Storybook. Package shape, synthesized entry from `srcDir: components/ui` (only the self-contained UI primitives; feature components import `next/*`, `next-auth` and server `@/lib/*` so they are deliberately out of scope).
- `components/ui/` itself now has files importing `next/link` (`filter-bar.tsx`, `link-tabs.tsx`). Bundled, `next/link` throws `process is not defined` and every card renders empty. `.design-sync/overrides/source-kit.mjs` (declared in `libOverrides`) drops any src file importing `next/*` from the synthesized entry, and `componentSrcMap` nulls `FilterBar`, `LinkTabs` and `Count` from the component list. `Field` is nulled too: it is the label wrapper `TextInput`/`Select`/`DateField` already own.
- The fork imports `ts-morph`, so it needs `.design-sync/node_modules` -> `.ds-sync/node_modules`. On Windows make it a junction: `cmd //c "mklink /J .design-sync\node_modules .ds-sync\node_modules"`. On re-sync, diff the fork against the bundled `lib/source-kit.mjs`; adding or removing the fork re-keys every grade (full regrade).
- The host has no `node_modules` (the app runs in Docker): run `pnpm i --frozen-lockfile` on the host before `buildCmd`.
- Always pass `--entry ./dist/index.js` (nonexistent on purpose): it anchors the package dir at the repo root; without it the converter looks for `node_modules/thunderstrux` and crashes.
- CSS is Tailwind v4, so it must be compiled first: `buildCmd` = `node .design-sync/build-css.mjs` -> `.design-sync/.cache/thunderstrux.css` (`cssEntry`). Re-run it before every sync; it needs `pnpm install` for postcss + `@tailwindcss/postcss`.
- Tailwind only emits classes it sees in source (whole repo is scanned). `build-css.mjs` adds an `@source inline(...)` safelist of common spacing/type/layout utilities so the design agent's own layout glue works, with `sm:`/`md:`/`lg:` variants (conventions promises them; until 2026-10-25 only `grid-cols` had them). `conventions.md` documents that safelist; keep them in sync.
- Grep compiled classes with `grep -F '.lg\:gap-8'`: a plain regex `\:` matches `:` and misses the escaped class.
- Fonts: the app uses `next/font/google` (DM Sans, Space Grotesk), which injects `--font-dm-sans` / `--font-space-grotesk` at runtime. `build-css.mjs` instead `@import`s Google Fonts and defines those variables (validate prints `[FONT_REMOTE]`, expected).
- `guidelinesGlob` is narrowed to the visual design spec. The default would also upload the PRD, DB schema and MVP plans from `docs/`; do not widen it without the user's OK.
- `docsMap` points every component at a stub in `.design-sync/docs/` whose only content is a `category:` (Actions/Forms/Feedback/Layout) so the picker groups them.
- `ConfirmDialog` uses `cardMode: single`, `640x420` so the open `<dialog>` renders inside the card.
- Bash tool on this machine truncates commands over ~8,000 chars: write files with the Write tool.
- Local Node was 22.18 vs the repo pin 22.23.3; the build was unaffected.

## Re-sync of 2026-10-25
- Authored previews for `EmptyState`, `ResponsiveTable`, `DateField`, `DateTimeField`, `MoneyInput` and `AuditTimeline`, ported from their call sites (analytics, calendar, history, orders). `ResponsiveTable` and `AuditTimeline` use `cardMode: column`.
- `ResponsiveTable` shows the table only from 768px wide (`md:`); the card list below that is the caller's markup, so the preview shows the table.
- The `Icon` preview now lists all 27 icons. `text-caption`/`text-ui` compile (seen in source).
- `conventions.md` was validated: every class, `--ts-*` token and component it names exists in the build. It does not mention the six new components yet (each has its own `.prompt.md`); adding them to its Rules bullet is a candidate edit for its owner.

## Known render warns
- `[FONT_REMOTE]` DM Sans / Space Grotesk: expected, see above.
- ConfirmDialog `Busy` cell shows a dark outline on the dialog: all buttons are disabled so the dialog itself takes focus. True to the product.

## Re-sync risks
- Re-sync of 2026-10-16 (after the UI redesign): Button and StatusBadge counted as "unchanged" because grades follow preview sources, not styling, even though their look changed (dot badges, neutral disabled buttons). They were spot-checked with `--spot-check-components`; do the same after any token or primitive restyle.
- `Icon` uses `cardMode: column` (the labelled grid is wider than a grid cell). Its preview lists icon names by hand: add new icons there when `components/ui/icon.tsx` grows.
- A new `components/ui/*` file that imports `next/*` silently drops out of the bundle (the fork). If it should be synced, remove the `next/*` import or stub it; if not, null its exports in `componentSrcMap`.
- `text-neutral-icon` is not compiled (nothing in the app uses it); neutral dots use `bg-neutral-icon`. conventions.md says so; keep it that way unless the app starts using the class.
- Previews and conventions hardcode component props and class names. If `components/ui/*` or `app/globals.css` tokens change, re-run the driver and re-validate `conventions.md` names (class table, `--ts-*` list).
- Google Fonts are fetched at runtime; if offline the render falls back to system fonts.
- New components in `components/ui/` are picked up automatically as floor cards; add `docsMap` + `previews/` entries to author them. Components outside `ui/` need `srcDir` changed and likely stubs for `next/link`/`next/navigation`.
- Render check was a full capture; anchored re-syncs will sample.
