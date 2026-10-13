# design-sync notes

Project: "Thunderstrux UI" — https://claude.ai/design/p/6075c42a-6f43-4f56-8d3c-6554004a550a (8 components from `components/ui/`).

## How this repo is synced
- Not a published package: no `dist/`, no Storybook. Package shape, synthesized entry from `srcDir: components/ui` (only the 8 self-contained UI primitives; feature components import `next/*`, `next-auth` and `@/lib/*` so they are deliberately out of scope).
- Always pass `--entry ./dist/index.js` (nonexistent on purpose): it anchors the package dir at the repo root; without it the converter looks for `node_modules/thunderstrux` and crashes.
- CSS is Tailwind v4, so it must be compiled first: `buildCmd` = `node .design-sync/build-css.mjs` -> `.design-sync/.cache/thunderstrux.css` (`cssEntry`). Re-run it before every sync; it needs `pnpm install` for postcss + `@tailwindcss/postcss`.
- Tailwind only emits classes it sees in source (whole repo is scanned). `build-css.mjs` adds an `@source inline(...)` safelist of common spacing/type/layout utilities so the design agent's own layout glue works. `conventions.md` documents that safelist; keep them in sync.
- Fonts: the app uses `next/font/google` (DM Sans, Space Grotesk), which injects `--font-dm-sans` / `--font-space-grotesk` at runtime. `build-css.mjs` instead `@import`s Google Fonts and defines those variables (validate prints `[FONT_REMOTE]`, expected).
- `guidelinesGlob` is narrowed to the visual design spec. The default would also upload the PRD, DB schema and MVP plans from `docs/`; do not widen it without the user's OK.
- `docsMap` points every component at a stub in `.design-sync/docs/` whose only content is a `category:` (Actions/Forms/Feedback/Layout) so the picker groups them.
- `ConfirmDialog` uses `cardMode: single`, `640x420` so the open `<dialog>` renders inside the card.
- Bash tool on this machine truncates commands over ~8,000 chars: write files with the Write tool.
- Local Node was 22.18 vs the repo pin 22.23.3; the build was unaffected.

## Known render warns
- `[FONT_REMOTE]` DM Sans / Space Grotesk: expected, see above.
- ConfirmDialog `Busy` cell shows a dark outline on the dialog: all buttons are disabled so the dialog itself takes focus. True to the product.

## Re-sync risks
- Previews and conventions hardcode component props and class names. If `components/ui/*` or `app/globals.css` tokens change, re-run the driver and re-validate `conventions.md` names (class table, `--ts-*` list).
- Google Fonts are fetched at runtime; if offline the render falls back to system fonts.
- New components in `components/ui/` are picked up automatically as floor cards; add `docsMap` + `previews/` entries to author them. Components outside `ui/` need `srcDir` changed and likely stubs for `next/link`/`next/navigation`.
- Render check was a full capture; anchored re-syncs will sample.
