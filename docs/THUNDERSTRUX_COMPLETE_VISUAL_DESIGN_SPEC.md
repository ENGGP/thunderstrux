# THUNDERSTRUX

**Document authority:** Follow the [PRD authority contract](THUNDERSTRUX_PRD.md), reconciled 11 October 2026. This document governs its assigned subject within accepted product scope and readiness-plan invariants; it is not evidence of deployed features.
## Complete Visual Design System, Page Designs and Frontend Handoff

**Version:** 1.0 | **Prepared:** 9 October 2026 | **Status:** Proposed design specification, not proof of implementation or product approval
**Audience:** Product/UI designers, UX researchers, frontend developers, QA, Claude Code and Codex
**Design direction:** **THE CAMPUS EDITION** - a purple-first, editorial event brand paired with a precise, calm society operations application
**Baseline:** Australian student societies; `en-AU`-appropriate AUD amounts, UK English UI wording and society-configured timezone (initial `Australia/Brisbane`).

> **Purpose.** Describe what **every screen** of Thunderstrux looks like, how its visual hierarchy works, which components it uses, what changes across viewports and product states, and what an implementation agent must not invent. This is a visual-design companion to the supplied flow specification, **not** a replacement for it. It should help produce a recognisable, human-designed ticketing product rather than a collection of generic AI-generated dashboards.

### Quick navigation

- [1. Visual identity and competitor synthesis](#1-the-design-thesis)
- [2. Purple tokens, typography, spacing and art direction](#2-purple-first-design-tokens-normative-design-proposal)
- [3. Shells, navigation and responsive layouts](#3-shared-shells-and-exact-responsive-composition)
- [4. Shared components and UI contracts](#4-core-components-appearance-and-implementation-contracts)
- [5. Public discovery, events and society pages](#5-public-marketplace-and-society-pages-complete-page-designs)
- [6. Authentication and account security](#6-identity-authentication-and-sensitive-account-pages)
- [7. Tickets, membership and merchandise checkout](#7-buying-and-purchase-recovery-screens)
- [8. Personal member dashboard](#8-member-dashboard-and-personal-pages)
- [9. Organisation dashboards and operations](#9-organisation-and-staff-pages-complete-design-coverage)
- [10. Annotated structural wireframes](#10-annotated-structural-wireframes)
- [11. UI truth, states, error pages and emails](#11-screen-states-shared-error-pages-and-critical-ui-truth)
- [12. Accessibility and visual testing](#12-accessibility-quality-engineering-and-responsive-acceptance)
- [13. Coding-agent acceptance matrix for all 43 screens](#13-design-to-code-implementation-contract)
- [14. Cross-document consistency and open decisions](#14-consistency-review-and-decision-register)
- [15. Research and uploaded sources](#15-references-and-provenance)

### Source hierarchy, documents and implementation authority

1. **`THUNDERSTRUX_PRD.md` [SRC-PRD]:** product requirements, permissions, audiences and boundaries are authoritative.
2. **`MVP_READINESS_PLAN.md` [SRC-PLAN]:** technical scope, transitions, dependencies, transactional rules, implementation and release constraints are authoritative within PRD scope.
3. **`THUNDERSTRUX_UX_USER_FLOW_SPEC.md` [SRC-FLOW]:** journey J01-J15, screen IDs PUB/AUTH/BUY/PER/ORG, architecture and UX acceptance govern navigation and intended behaviour.
4. **This document [DS]:** design direction, responsive composition, visual components, content hierarchy, detailed screen treatments and design QA. For scope, invariants and interactions, **1-3 override this document**. This document owns presentation tokens/composition and explicitly supersedes FLOW section 5.1's earlier token proposal; use the subject-specific authority above. Actual code/schema/guards must be inspected for current implementation facts; never rewrite services or routes because a mock-up suggests it.

**Notation:** `[P]` PRD requirement; `[I]` implementation-plan constraint; `[U]` existing flow-spec design; `[D]` *new visual design choice*; `[E]` future enhancement, not a live control; `[V]` requires inspection of current repository. References such as `T24` refer to the supplied implementation-plan tasks, **not new work packages**. Existing `/events/[eventId]` and `/tickets` links must remain usable. All suggested routes are **IA targets**, not assertions of deployed Next.js paths.

**Implementation boundary:** This design does not authorise seat maps, QR scanning, mixed product baskets, automatic membership renewals, shipping, recurring event automation, discount-code infrastructure, unscoped AI tools, or a public personal calendar. Do not add functional buttons for those capabilities. Money, availability, membership grants, payment and refund status always come from authorised services, never CSS or client guesses. [SRC-PLAN §§3.2-3.4; SRC-FLOW §§0, 9-11]

---

# 1. The design thesis

## 1.1 A nameable identity rather than a template

**Creative concept: _The Campus Edition_.** Thunderstrux should feel like the meeting point between a student culture magazine, a polished ticket window, and a serious operations desk. Public pages have personality through large real event photography, sharply composed typography, an unusual **vertical date rail**, fine rules, and restrained deep-violet editorial blocks. Transactions become quieter and almost invisible; organiser pages are efficient and information-dense without feeling corporate.

**Brand formula:** **65% authentic content and usable neutrals + 25% sophisticated plum/violet + 10% vivid accents and deliberate graphic detail.** This is a proportional art-direction heuristic, not a hard per-page CSS calculation. A pale background and purple titles feel purple-first even when purple is not painted on every card.

**Distinctive recurring brand devices [D]:**

- **Date rail.** On event cards and editorial lists, an aligned day and three-letter month anchor the layout before the title. It makes the platform recognisably about what's happening, not a generic store.
- **Violet editorial rule.** A 3px purple line, occasionally paired with a very small diagonal cut at the end, marks key sections and selected tabs. No busy glowing outlines.
- **Ticket edge.** A *subtle, functional* clipped/perforated edge appears only on issued ticket visualisations, not on every card. Ticket ID and validity remain plain text.
- **Quiet square geometry.** Editorial blocks have moderately squared edges and selective 14px radii; controls are rounded just enough to feel contemporary. Do **not** use identical huge `rounded-3xl` boxes everywhere.
- **One restrained micro-accent.** A pale chartreuse (`#DEF17B`) highlights occasional editorials/date markers and event categorisation; it must **never** represent paid, verified, eligible or safe.
- **Society-as-publisher.** Every public event sits under the hosting society's visible name/logo. The society owns its content but Thunderstrux owns the checkout chrome, accessibility and trust cues.

**Avoid:** giant gradient-purple hero with floating dashboard illustration; glowing blobs; stock-photo handshake; ubiquitous lightning bolts; emoji in the main navigation; four equal metric cards everywhere; default Lucide icon on every heading; giant rounded pill buttons for all actions; large borderless forms with placeholder-only fields; ornamental graphs showing fictional growth. These are common template shortcuts, not a coherent identity.

## 1.2 Experience tone by context

| Context | Visual treatment | Emotional objective | What remains identical |
|---|---|---|---|
| Public landing / discovery | Strong editorial typography, photography, violet chapter dividers, generous rhythm | Curiosity; campus belonging | Navigation, colour contrast, prices, search semantics |
| Event detail | Image-led editorial page + extremely legible purchase panel | Excitement followed by buying confidence | Clear venue/date/host, purchase rules, totals |
| Society profile | A society's authentic banner/photo; shared Thunderstrux grid and purple nav | Local identity, membership community | Actions and accessibility; no society-controlled danger/status colours |
| Checkout / recovery | White/paper surfaces, compact identity, thin violet progress rail | Security, low cognitive effort | Authoritative quote, permissions, honest payment status |
| Personal member area | Softer lilac/warm-paper content; tickets and upcoming dates first | Ownership, calm, usefulness | App shell and terminology |
| Organisation back office | Mostly neutral, dense, structured, minimal decorative elements | Speed and confidence for volunteers | Purple actions, consistent forms/tables, permission gates |
| Check-in / collection | High contrast, large clear touch actions, almost zero ornament | Fast and error-resistant operations | Server-confirmed states and audit |
| OpenClaw | First-party work panel, not a flashy chatbot | Transparency and control | Action previews, confirmation, scope |

## 1.3 Competitor inspiration: observed vs adopted

These comparisons are **design inferences** from official product/help documentation and published product imagery reviewed 9 October 2026. They are *not* claims that our team inspected every live checkout or that a competitor's exact pixels are current. Do not reproduce anyone's layout, logo, proprietary artwork or copy verbatim.

| Reference | Observed/documented visual or interaction pattern | Thunderstrux design synthesis | Refuse to inherit |
|---|---|---|---|
| **Humanitix** | Large event banners and branding; ticket-selection-first journey; event-page styling/preview; clear checkout stages [R1, R2, R3] | Editorial 16:9/2:1 hero + right hand purchase panel, readable ticket rows, preview beside publish | Its entire styling/template editor, added checkout products and feature set |
| **Eventbrite** | Image-forward event listing, highly recognisable date/title/venue, clearly separated order selection and receipt; staged event creation [R4, R5] | Scan-friendly event cards and a precise order-summary column, progressively revealed publish builder | Big marketplace chrome, discount codes, seating, invented add-ons |
| **Rubric** | Society hub housing events, paid membership and merchandise; clear membership validity and products [R6, R7] | Society profile is the product hub, three purchase categories clearly separated | Their visual branding, subscriptions, mixed shopping carts, unapproved club features |
| **Luma** | Compact event registration and calendar identity; optional theme tuning; public/private/member-gated events [R8, R9] | Crisp event metadata hierarchy, society calendar ownership, restrained colour/titles | Animated effects or custom themes on security/payment screens |
| **Ticket Tailor / TryBooking** | Ticket types/stock and focused event builders, preview-before-publish [R10, R11] | Strong inventory rows, builder progress and readiness checklist | Seat allocation, POS, unsupported ticket groups |

**Explicit choice:** Thunderstrux borrows the **familiarity of ticketing UI** without inheriting competitors' feature contracts. Membership, merchandise and tickets each have their own checkout/order domain. Guests require verified email access before purchasing; all fixed-term membership products, free or paid, require a verified member account. [SRC-FLOW §2; SRC-PLAN T16, T20-T29]

---

# 2. Purple-first design tokens (normative design proposal)

Tokens below are deliberate design choices, not claims about an existing theme. Adopt a single namespaced token source. If existing repository tokens differ, plan a controlled migration with visual regression tests rather than adding conflicting Tailwind values ad hoc.

## 2.1 Core palette [D]

| Design token | Hex | Intended use | Constraint |
|---|---|---|---|
| `--ink` | `#24143B` | Hero headings, body on light surfaces | Main text; ~16.3:1 on paper |
| `--ink-soft` | `#594F67` | Secondary copy, labels and meta | ~7.4:1 on paper |
| `--ink-muted` | `#6B6276` | Tertiary explanatory text | ~5.6:1 on paper; test each actual surface |
| `--violet-900` | `#2A1550` | Editorial blocks, premium dark surfaces | White text or controlled pale accent only |
| `--violet-800` | `#4C22AF` | Pressed buttons, active state | White text |
| `--violet-700` / `--brand` | `#5B2ACB` | Primary CTA, text links, focus family | White text ~8:1; body links on paper |
| `--violet-600` | `#6E3CDB` | Non-critical graphic highlight, selected charts | White text ~6.3:1, but check background |
| `--violet-200` | `#DCCFFA` | Active secondary surfaces, outlines | Never text colour on white |
| `--violet-100` | `#F0EAFE` | Soft panel, badge background | Pair with dark purple text |
| `--paper` | `#FBFAFD` | Public/member page background | Off-white lavender-tinted canvas |
| `--warm-paper` | `#FCFAF5` | Editorial hero sections / genuine photography backdrop | Limited to sections, not transactional summary |
| `--surface` | `#FFFFFF` | Checkout/forms/cards/admin tables | Opaque white |
| `--surface-2` | `#F5F2FA` | Row hover, table zebra, neutral sidebar | Distinct from page canvas |
| `--line` | `#DDD6E7` | Borders, rules, inputs | 3:1 required where boundary is sole indication of control |
| `--line-strong` | `#9E8AAC` | Input boundaries on white and drag affordance | Ensure non-text contrast vs surrounding surface |
| `--lime` | `#DEF17B` | Sparing editorial highlight on dark violet | Decorative only; not a trust/status colour |
| `--success` | `#146B50` | Confirmed, fulfilled, checked in | Colour and word/icon together |
| `--success-bg` | `#E9F6ED` | Confirmation wash | Dark green text |
| `--warning` | `#834500` | Needs action/processing | Colour and word together |
| `--warning-bg` | `#FFF3DF` | Pending/readiness wash | Dark amber text |
| `--danger` | `#9A3F53` | Destructive actions, invalid/refunded | Do not use violet for danger |
| `--danger-bg` | `#FFF0F3` | Failure/invalid wash | Dark red text |
| `--info` | `#254C88` | Non-financial informational states | Not a substitute for label |
| `--info-bg` | `#EAF2FF` | Information banner | Stable shade |
| `--focus` | `#1E72D8` | Focus ring distinguished from purple buttons | Explicit 2px outer + white separation |

**Accessible colour discipline:** Contrast ratios shown are indicative calculations using the exact colour pairs, **not a WCAG certification**. Check real combinations, overlays and disabled states. Body text >=4.5:1, large text >=3:1, essential UI boundaries >=3:1 where required by WCAG 2.2 AA. Do not dim critical financial/status copy below threshold. At 200% zoom and 320 CSS px width, preserve content with no two-dimensional scrolling outside legitimate tables. [R12]

### CSS token contract

```css
:root {
  color-scheme: light;
  --ts-ink: #24143b;
  --ts-ink-soft: #594f67;
  --ts-ink-muted: #6b6276;
  --ts-brand: #5b2acb;
  --ts-brand-hover: #4c22af;
  --ts-brand-tint: #f0eafe;
  --ts-brand-ink: #2a1550;
  --ts-paper: #fbfafd;
  --ts-surface: #ffffff;
  --ts-surface-subtle: #f5f2fa;
  --ts-border: #ddd6e7;
  --ts-input-border: #9e8aac;
  --ts-focus: #1e72d8;
  --ts-success: #146b50;
  --ts-warning: #834500;
  --ts-danger: #9a3f53;
  --ts-lime: #def17b;
}
```

Prefer semantic names in components (`bg-page`, `text-primary`, `border-control`, `bg-action`) rather than using raw `purple-500`, which quickly fragments an agent-generated codebase. Include CSS variables in an established Tailwind theme entry point **after confirming repo version/config**. Organisation cover images and brand swatches cannot replace purchase, danger, success or security colours. No automatic dark-mode support is implied by the purple dark editorial sections.

## 2.2 Type hierarchy and typography [D]

**Recommended pairing:** `DM Sans` for UI copy, labels and data + `Space Grotesk` for editorial/public headings and high-level page titles. If unavailable or not licensed through the project's chosen delivery method, use locally available/system sans fallback; do **not** silently fetch fonts from arbitrary runtime hosts. Use `font-display: swap`, preload only the necessary subset and measure CLS. No font files belong in the delivered document.

| Text style | Desktop size / line height | Mobile size / line height | Weight / usage |
|---|---|---|---|
| `display-xl` | 64px / 1.06 | 40px / 1.10 | 600, homepage only; short editorial lines |
| `display-lg` | 48px / 1.12 | 34px / 1.14 | 600, public society/event title |
| `heading-1` | 36px / 1.17 | 29px / 1.20 | 600, one main H1 per page |
| `heading-2` | 26px / 1.24 | 23px / 1.28 | 600, primary content section |
| `heading-3` | 20px / 1.35 | 19px / 1.35 | 600, card headings |
| `body-lg` | 18px / 1.60 | 17px / 1.55 | 400, event summaries/editorial lead |
| `body` | 16px / 1.55 | 16px / 1.55 | 400, defaults, form help, checkout |
| `body-sm` | 14px / 1.50 | 14px / 1.50 | 400/500, operational metadata |
| `label` | 14px / 1.35 | 14px / 1.35 | 600, field/table heading |
| `eyebrow` | 11-12px / 1.4 | 11-12px / 1.4 | 700 with mild tracking, decorative category only; **never** necessary legal or price text |
| `money` | 22-28px / 1.2 | 22-26px / 1.2 | 600 tabular figures, totals |

Public H1s may be editorial; admin H1s **must not** be enormous. Operational table text is minimum 14px and important figures at least 16px. Avoid capitalising whole sentences. Use en-dash when appropriate to indicate ranges, not em dashes. Money is formatted via `Intl.NumberFormat('en-AU', {style:'currency', currency:'AUD'})`, using server-canonical integer cents; dates use the society's actual IANA timezone and show an explicit readable zone.

**Typographic personality:** left-aligned headings; controlled line lengths (public max 65ch, descriptions 70ch); 1-2 highly intentional line breaks in marketing hero rather than random centring. Event typography draws emphasis from the title/photo, not a font-size arms race. Data tables use tabular numerals, `font-variant-numeric: tabular-nums`.

## 2.3 Spacing, grids, radii and shadows [D]

| Token | Value | Purpose |
|---|---|---|
| `space-1 / 2 / 3 / 4` | 4 / 8 / 12 / 16px | Form/component density |
| `space-5 / 6 / 8 / 10` | 20 / 24 / 32 / 40px | Card rhythm |
| `space-12 / 16 / 20 / 24` | 48 / 64 / 80 / 96px | Public section rhythm |
| `radius-sm` | 6px | Tags, dense admin controls |
| `radius-control` | 9px | Inputs and buttons |
| `radius-card` | 14px | Standard cards |
| `radius-feature` | 20px | Only significant editorial feature panels |
| `radius-sheet` | 18px top | Mobile bottom sheets |
| `shadow-float` | `0 14px 44px rgba(36,20,59,.12)` | Sticky panel/drawer **only** |
| `shadow-card` | `0 4px 18px rgba(36,20,59,.055)` | Marketing card hover at most |
| `page-max` | 1248px | Public, society and broader admin |
| `read-max` | 760px | Long event description/policy |
| `auth-max` | 440px | Login, recovery |
| `checkout-max` | 1060px | Confirmation/review |
| `admin-max` | 1420px | Orders and operational tables |

Desktop public grid uses **12 columns / 24px gutter / 32px side padding** (minimum). Tablet uses **8 columns / 20px gutter / 24px padding**. Mobile uses **4 columns / 16px gutter / 16px padding**, or 20px padding >=400px. Marketing breakpoints `sm >= 640`, `md >= 768`, `lg >= 1024`, `xl >= 1280`; content/available width matters more than device labels. Use CSS Grid and modern container queries where already supported; do not hide information behind breakpoint-only actions.

**Section scale:** 72-96px vertical separation for editorial home; 48-64px event/society pages; 28-40px member pages; 20-32px admin. No random `mt-40` offsets to make a screenshot look attractive. One consistent button height (44px standard, 48-52px primary purchase/door action, 36px dense admin), and touch controls target at least 44x44px where practicable (WCAG AA minimum is 24x24 or the defined spacing exceptions). [R12]

## 2.4 Iconography, photographs, illustration and motion

- **Icons:** use a coherent outlined family already in the repository or one well-maintained set; 18-20px for nav/rows, 22-24px for major actions. Icons support labels; do not communicate states only with icons or colours. Stroke weight remains visually consistent.
- **Photography:** real society activities, people in venues, university spaces, products and events. Prioritise organiser-supplied cover images, then a branded non-fake geometric placeholder. Never fabricate real student testimonials or attendance figures. Respect privacy and image rights.
- **Cropping:** event discovery card `3:2`; hero `16:9` or wide 2:1 content-safe; society cover `3:1` desktop, `16:9` mobile; merchandise `4:5` with object-contain option for garment flat lays. Set focal position using valid object-position metadata where supported, else centred crop. Never stretch photos.
- **Image treatment:** no blanket purple gradient over every image; at most a subtle dark scrim where text truly overlays media. Prefer keeping text **outside** the image; critical date/title must not be baked into a photo.
- **Placeholder:** pale violet block with tiny corner date label, a custom restrained line geometry, and alt-appropriate empty status. Do not use random AI art for societies that supplied no imagery.
- **Motion:** 120-180ms transitions for hover/menus, 200-260ms drawer reveal; opacity/transform only; no parallax, auto-rotating hero or attention-grabbing infinite loading shimmer. Respect `prefers-reduced-motion: reduce`.
- **Loading:** stable structural skeleton preserving layout; 1 skeleton family, not decorative pulsing gradients. After 300ms loading use polite status text for critical payment checks.
- **Trust graphics:** receipts and payments always use stable neutral surfaces and the Thunderstrux emblem, not society-selected full-page theme colours. Never imitate Stripe's hosted page in an untrusted form.

---

# 3. Shared shells and exact responsive composition

## 3.1 Public marketing shell `PublicShell`

**Desktop >=1024:** 72px header, logo left; nav `Explore events | Explore societies`; right side `My tickets` (authenticated) and account menu, otherwise `Sign in` and a distinct but restrained `Create a society`. Header bottom rule 1px. Use a max-width 1248px content rail. On home, show dark-violet chapter hero followed by paper-white discoveries. Footer has Support, Contact, Terms, Privacy and company identification; legal content/URLs must come from actual product configuration rather than invented policies.

**Tablet 768-1023:** keep logo/search, hide low-priority nav into menu. **Mobile <768:** 60px header with brand, search button and labelled Menu. Menu opens accessible slide-over with focus lock, return focus and overlay click closure. Do not add a generic persistent five-tab bottom nav to public pages. On long event/product pages only, show a sticky **purchase bar** after the inline purchase CTA scrolls out of view; bar contains an honest price range/Free and CTA and respects safe-area inset.

`PublicShell` never exposes internal routes for anonymous users. `SocietyShell` inherits header/footer and its own society navigation.

## 3.2 Society/public hub shell `SocietyShell`

- Desktop above-the-fold: cover photo (about 250-320px high), overlapping 72px logo or branded monogram anchored bottom-left, society title and short description to right/below. Verified identity means only that it is a profile hosted on Thunderstrux; **do not invent a trust/verified badge**.
- Immediately below: tabbed link navigation `Overview | Events | Memberships | Merchandise`. Tabs are **navigation links** if they change routes; URL controls active state. Sticky only when not obscuring viewport; keyboard scrolling works.
- Primary header CTA is conditional: `Join society` for free affiliation; `Joined` state after confirmed join; a separate `Get membership` action inside membership content. Joining free does not unlock paid member prices. Distinguish these visually and in words.
- Society branding customises cover/logo imagery, **not** primary CTA or status semantic palette. On mobile cover 16:9, title and Join action stack; nav scrolls horizontally with visible overflow, active underline and clear focus.

## 3.3 Checkout shell `CheckoutShell`

- 64px restrained header: small Thunderstrux brand left; “Booking for [society]” / order kind; secure checkout *text* without claiming PCI processing occurs inside Thunderstrux. Link back to the source product, not general marketing nav.
- Desktop: max-width 1060px, content 7 columns and summary 5 columns, 28px gutter. Main contains compact stepper `Tickets > Details > Review` (plus Stripe payment as external step), labelled form and clear final action. Summary panel has small event image, schedule, selected item snapshot, totals, seller/support and policy link.
- Mobile: narrow column, fixed-priced call to action only while safe and necessary; an accessible collapsible `Order summary · A$...` line above final CTA. Expanded policy remains findable before payment, not hidden behind a hover tooltip.
- Stripe-hosted payment is a redirect and **not** a Thunderstrux-made credit card form. Returning from provider goes to an authoritative order-state page; visually show `Checking payment status` until server confirmation. Do not use purple animated success page without verified order/ticket state. [SRC-PLAN §3.2; R13]

## 3.4 Personal/member shell `PersonalShell`

- Reuse public brand/header while signed in, with distinct **Personal** context badge and an unobtrusive section sidebar at >=1024: `Overview | My tickets | My memberships | Societies | Purchases | Account`.
- Content max 1160px, 10px white cards on tinted background, date-rich featured ticket. Hero height deliberately shallow (~200px maximum) so useful content remains on screen.
- Member who also works on a society can switch via explicit `Personal / Manage [Society]` context selector; switching never changes backend authority by client fiat. On mobile, drawer with plain labels and selected context; no personal order information on public pages.

## 3.5 Organiser shell `OrganisationShell`

- Desktop >=1200: 244px stable **deep-plum** sidebar, near-white body. Sidebar starts society logo/name and a clearly labelled organisation context. Groups:
  - **Run:** Overview, Events, Calendar, Orders
  - **Community:** Members, Memberships, Merchandise
  - **Understand:** Analytics, Payments
  - **Settings & tools:** Staff, OpenClaw, Settings, History (only if authorised)
- `Orders`, `Payments`, finance charts and `Staff` are **not** assumed visible to every staff account; filter by *server-supported capability*, including role and enrolled MFA where required. Sidebar labels 14px/500, row height 40-44px; active item has pale violet surface, high-contrast white/ink text as appropriate and 3px left marker. No flashing rainbow gradients.
- 64px main header: breadcrumb/context + account/staff identity, organisation state. Body uses max-width 1420px, 32px padding. H1 + single primary action; toolbar/filters below. Lists and charts appear after task/status elements.
- Desktop 768-1199: collapsed icon+tooltip rail **only if icons retain accessible names and expansion control**; otherwise use a drawer. Mobile <768: standard 60px top bar with society identity and Menu; labelled drawer; filters wrap or open sheet. **Check-in and pickup workflows are full-width task pages** rather than compressed multi-column dashboards.
- Public preview in authorised staff context carries `DRAFT PREVIEW` banner and hides buy CTA; does not publish for a moment to preview.

## 3.6 Overlay and navigation specification

| Pattern | Use | Required behaviour | Never use |
|---|---|---|---|
| Inline panel | Ticket selector and standard settings | Visible with page content on desktop | Full-screen modal for trivial selection |
| Drawer / bottom sheet | Small mobile ticket selector, mobile nav, quick filters | Focus trap only for modal, proper Escape, scroll containment, announce title, restore focus | Drawer inside another drawer; obstruct final price |
| Modal | Destructive/irreversible action confirmation, OpenClaw confirm | Description of exact outcome, specific Confirm/Cancel, loading lock, focus return | “Are you sure?” with no consequences |
| New route | Receipt, membership purchase, long edit flow, admin detail | Back link to owning item, preserve filter/search state | Single giant modal for many forms |
| Toast | Non-critical successful save/copy | Accessible polite region and persistent detail where relevant | Toast as only record of payment/refund |
| Alert/inline error | Eligibility, price conflict, payment ambiguity, security issue | Persistent, linked to recovery CTA, role alert | Colour-only badge or fleeting toast |

---

# 4. Core components: appearance and implementation contracts

The component library is shared. Agent implementations must use the design tokens above and *semantic variant props*, not custom CSS copied into each page. Components indicate visual state; domain services determine truthful state. Recommended names may be mapped to repository conventions after inspection.

| Component | Visual anatomy (desktop) | Mobile behaviour | States / accessibility |
|---|---|---|---|
| `EventCard` | 3:2 image, 68px date rail + event title, host text, location and genuine `From A$...`/`Free` line | Single-width or 2-column cards >=600px; never crop necessary text | Public/closed/sold-out labels; one semantic link; images optional |
| `CompactEventRow` | Date block + title/venue + compact status / action | 3-line stack | Used in personal upcoming, calendar agenda, admin |
| `SocietyCard` | Logo/avatar, name, short description, next event microline | 1-col | Join badge distinct from membership entitlement |
| `MembershipOfferCard` | Society name, product, fixed term, current/next status, price, 2-3 verifiable benefits | Full-width, one CTA | Free/paid; verified-only; cannot show auto-renew |
| `MerchProductCard` | 4:5 photo, title, from price, pickup label, optional variant count | 2-col mobile if >=375px; 1-col if needed | Draft concealed, sold out, archived (history only) |
| `TicketTypeRow` | 1fr name/notes; price right; quantity controls far right; hairline bottom rule | Stacked price+controls below description | Sold out, closed, member-only, insufficient stock, price changed; reason visible |
| `TicketFace` | Branded ticket edge, event and local date, type snapshot, ticket identifier, status at top | Fits 320px without horizontal scroll | Valid, checked-in, void, refund review; **not** fake QR |
| `StatusBadge` | Small radius 6px, coloured background + icon/label | Same | Typed state from server; not colour-only; status strings map from truth tables |
| `MoneySummary` | Item rows > subtotal > actual disclosed fees > total with top divider | Collapsible summary + fixed total row | AUD with tabular numbers; no derived pricing authority |
| `MetricTile` | Small eyebrow, large **truthful** number, scope/time below, link to details | Two-col only when readable | Loading/no data/unknown; no invented percentage change |
| `FilterBar` | Search, filters, date scope, Clear | Filters sheet or stacked | URL query persistence where appropriate; count and focus |
| `DataTable` | 44-52px rows, right-aligned numbers, sticky header only where stable | Row cards for complex tables, horizontal overflow as last resort | Sort label, selected row, permission-redacted columns |
| `ReadinessChecklist` | Vertical list of incomplete checks with concrete Fix links | Full width | Derived from readiness service; no claim of readiness if server blocks |
| `CalendarGrid` | Weekday header, month cells, up to 3 lines per day then “+N more” | Agenda instead of minuscule 7-col cells | Keyboard move/date announcement, multi-day span, timezone |
| `AuditTimeline` | Single rail with actor/action/when/safe facts | Full width | Permission scoped, no raw tokens/PII |
| `RoleSelector` | Explicit role labels with explanatory access text | Stacked radio options | Never allow browser role to grant actual permissions |
| `AssetPicker` | Dropzone with 16:9/3:1 crop preview, progress, alternate text | Tap to choose file, preview in-flow | Only JPEG/PNG/WebP, <=5MB, <=4096x4096, server re-encode [T07] |
| `ActionPreview` | Before/after diff, society, actor, consequences, expiry and buttons | Single-column card, bottom action row | OpenClaw confirmation; stale preview re-run; dangerous operations link out |
| `ContextSwitcher` | Personal or authorised society name, active context, concise menu | Accessible popover/drawer | Never joins society membership with staff access |
| `Field` | Persistent label + 44-48px control + help text + explicit error | 100% width | `required`, `aria-invalid`, `aria-describedby`; no placeholders alone |
| `EmptyState` | Small geometric illustration optional + explanation + **one** honest CTA | Same | Distinguish empty/not authorised/load failed |
| `InlineNotice` | 3px left semantic border, icon, title, message, link | Same | Info/warning/error/success with label and focus |
| `ConfirmDialog` | 480-560px; exact target, consequence, one destructive or normal CTA | Full-width bottom sheet where safe | Trap focus, restore, no click-outside to accidentally confirm |

## 4.1 Primary button recipes

- **Primary:** 48px height, `#5B2ACB` fill, white text 16px/600, 10px radius, 16-20px side padding; hover `#4C22AF`; pressed `#2A1550`; focus `2px white gap + 2px #1E72D8` outer outline; `disabled` has explanatory text and not only `opacity:0.4`.
- **Secondary:** 44-48px, transparent/white background, 1px **strong** border, dark-violet label; hover soft-violet tint.
- **Tertiary:** underline on hover *and keyboard focus*, no giant border; used for links and small secondary actions.
- **Destructive:** white surface + dark-red outline/text by default, solid danger only inside a confirmation dialog. Never render refund button in success-green.
- **Membership CTA:** primary purple for active eligible offer; if member is not verified, provide `Sign in to purchase` with a clear return route. Free society join uses secondary button and a separate word.
- **Mobile checkout:** final action fills width and states price and kind clearly (`Pay A$...`, `Confirm free registration`); while loading, replace label with descriptive status, keep width constant.

## 4.2 Price, data and status formatting

- `Free` always displayed instead of `A$0.00` for eligible zero-total acquisition; receipt must still show `A$0.00` in financial line items if appropriate, paired with **Free** state.
- `From A$8.00` only if backed by cheapest *currently selectable* ticket, not a sold-out price. If mixed paid/free and free is actually selectable, show `Free tickets available` and optionally `Paid tickets from A$...` as separate truths.
- Fees: only values from backend provider policy and snapshots. Platform fee may be withheld from organiser proceeds (plan's initial 10% Connect helper); don't manufacture buyer-facing surcharges. Do not label sales as “Payouts” or “Profit”.
- Membership date range is displayed as `1 Mar - 30 Nov 2027 (Australia/Brisbane)` or a clear equivalent of stored `[start,end)` boundaries, and must not imply inclusive midnight if end is exclusive. No subscription renewal badge.
- Merchandise says `Collection only` or `Pickup only`, always with location/instructions before final payment. After payment separate `Payment confirmed` and `Awaiting preparation` labels.
- `StatusBadge` accepts *typed domain values* and maps them through one shared function. Designers **must not** colour a pending/compensation state green because the browser landed on success URL.

## 4.3 Forms, sorting, charts and overflows

- Date/time input: clearly display society timezone beside controls and expose ambiguous/nonexistent DST times using a selectable offset or explicit correction rather than silently shifting.
- Price input: prepend `A$`, show two decimals, store cents with validated integer conversion on the server; avoid JS floats for authority.
- Lists: desktop tables where scanning matters, cards where imagery/context matters. Repeatedly use no more than **three** top-level metrics on page headers unless real decisions demand more.
- Charts: purple is primary series, ink secondary, green for confirmed only, orange for warnings. A real data table with matching values follows or is toggled accessibly; never gradient-filled 3D analytics or unexplained `+23.4%` comparisons.
- Dense admin pages can scroll vertically; data tables may scroll horizontally only with visible affordance and accessible header mapping. On 320px mobile, high-priority rows become definition lists.
- Every async component supports skeleton, verified empty, fetch error/retry, 401/403/404/409/429/503 where applicable, and reduced-motion. The screen recipes list domain-specific variants.

---
# 5. Public marketplace and society pages: complete page designs

**Every page in this section uses `PublicShell` unless specified.** The original flow IDs from [SRC-FLOW §6-7] are retained. On each page implement a document title, visible H1, correct auth/visibility, image alternative, mobile layout and loading/empty/error presentation; no marketing decoration may reveal restricted content. “Route” refers to conceptual route from source flow, not a mandate to overwrite live App Router structure.

## PUB-01 - Home `/`

**Purpose:** Answer “What's happening around me?” while showing that Thunderstrux is for societies, not just event ticket sales. **Layout:**

1. **Editorial hero:** desktop 60% text, 40% visual mosaic of *real* recent society event imagery with no fake attendee numbers. Deep plum `#2A1550` background and warm-paper text. A small chartreuse `YOUR CAMPUS, LIVE` label precedes a 2-3 line **Space Grotesk** H1: “Good things happen together.” Supporting line refers to events, memberships and society merchandise. The primary action **Explore events** is a light button on the dark hero; secondary **Discover societies** is a text link. No animated gradient.
2. **Immediate discovery strip:** search field and optional `When` / society filters depending on actual public query support; if search is not supported on home, use a prominent link to Explore events instead of pretending it filters.
3. **Happening soon:** 3-column desktop `EventCard` grid, 2 tablet, 1 mobile. Each card date rail, location, organiser, truthful price. A link `See all events` follows real results.
4. **Find your crowd:** mixed-dimension society-card row with proper organisation name/logo and single useful next action. Do **not** invent follower counts, ratings or reviews.
5. **How Thunderstrux works:** only three succinct annotated sections: discover events, join communities, run a society. Use purposeful cropped event/product screenshots only if they are real, not fake dashboards.
6. **Create a society** feature panel: off-white/purple border, clear admin-facing CTA; footer with accessible links.

**Mobile:** H1 max two-to-three lines at 40px, actual event card appears within early scroll; no inaccessible collage. Hero content precedes photo; don't let the design become a marketing-only page that buries discovery. **Special states:** no published events -> honest “No public events just yet” with society discovery; loading skeleton matches card positions; anonymous browsing never sends user to login for a public event. **Trace:** `[P]` PRD §§1, 6.4; `[I]` T09/T15; `[U]` PUB-01.

## PUB-02 - Explore events `/events` (proposed)

**Layout:** narrow left editorial eyebrow `DISCOVER / EVENTS` and H1 “What's on”; below a 56px search strip, `Date`, `Society`, `Price` only where supported (price can be derived/display-only; do not invent unsupported API filters), `Clear all` appears only when filters active. Desktop optional **left filter column (260px) + 3-card result grid**; otherwise use one full-width toolbar. Choice must be consistent and tested, not both competing filters.

**Cards:** 3:2 image, date rail, event name up to two lines, host, location/local time, status/price. Support Free, From A$..., Sold out and sales closed. Only public discoverable results appear; unlisted or member-only links must not be surfaced through global discovery. Search query and date filters are reflected in safe URL query params for shareability. Show result count accurately, use paginated **Load more** button if backend cursor pagination exists, focus returned to new results only where requested. Filters don't automatically submit on every character typed on slow mobile.

**Mobile:** single column with filter sheet under search, sort and Clear; date rail becomes 52px left block. **States:** zero results: “No events match those filters”, Clear filters; no public events: distinct copy; network failure: retry; private/foreign event details never exposed in preview. **Trace:** PRD 6.4, T15, PUB-02.

## PUB-03 - Public event detail `/events/[eventId]`

**Signature layout:** 12-column grid, hero image spans 8 columns, purchase panel 4; below image, description/host/policies use first 8 columns. Above fold includes `Society name > Event` breadcrumb, title (38-48px responsive), date/time with explicit timezone, city/venue, and **Get tickets** visible at first glance. Feature photo can be a 16:9 horizontal crop with modest offset; never put crucial title/date *inside* the photo.

**Purchase panel:** white surface, 14px border radius, restrained float shadow. Heading “Tickets”, earliest available price from authoritative quote, badge `Sales open`/`Free`/`Sold out`/`Sales closed`/`Payment unavailable` as separate concerns. Rows have 1px bottom dividers, ticket type title, description, regular/member price comparison when eligible, stock explanation, stepper with accessible buttons. **Default one ticket type per order** until service supports multi-type order [SRC-FLOW BUY-01]; do not draw a mixed-type shopping basket that backend cannot fulfil. CTA remains `Get tickets` / `Get free tickets`, not “Book now” with hidden fees. Below: host contact, refund policy, and what buyer receives.

**Body order:** `About the event` > `When and where` > `Hosted by [society]` > `Tickets and access` (where useful) > `Support/refund information`. Link host profile and correct membership offer, but buying membership does not automatically book a ticket. If members_only event is concealed, do not render event title or private description for ineligible users; show an appropriate route-level access/error pattern only after safe server check. Unlisted accessible through its valid link only when policy permits.

**Mobile:** first show title, date/time, venue, image and price/CTA without needing a long scroll. Inline ticket selection may open a labelled bottom sheet; sticky bar appears only when inline CTA is out of view. Tap targets >=44px. At 320px bar stacks price+button if necessary, preserves bottom safe area, doesn't cover form keyboard. **Variants:** ticket type sold out; paid ticket charges disabled but free remains purchasable; quote price changed -> inline notice and refreshed total; sale not yet open/closed; cancelled/unpublished path with non-leaking error; event time/location changed visibly (source of truth). **Trace:** PRD 6.3-6.7, T11-T16/T24, PUB-03/BUY-01.

## PUB-04 - Discover societies `/societies` (proposed)

**Visual:** “Find your people” editorial H1 in `Space Grotesk`, search centre stage, optional university/discipline filter **only when data exists**; no false local university selector. Grid of `SocietyCard` with genuine logo/description/next public event. The first row may be a featured broad editorial band only if editorial curation actually exists - otherwise use uniform card grid. Each result opens the society hub; cards never show staff-only member rosters or internal revenue.

**Mobile:** single-column comfortable society cards, search at top, scrolling filters. **States:** search has 0 results, no societies published, logged-out join CTA routes to login/verification with safe return path; join isn't a paid-membership grant. **Trace:** PRD 6.2/6.9, T09, PUB-04.

## PUB-05 - Public society home `/societies/[orgSlug]` (proposed)

**Layout:** branded photo cover and 72px round/square society logo, H1 society name, 1-3 line description, society contact link and visible `Join society` secondary button. One large type scale less aggressive than homepage. **Core section navigation** `Overview / Events / Memberships / Merchandise` all on the same society identity. Overview first shows **Next event**, then latest published events, the current valid membership offer and up to four merchandise products. Avoid displaying duplicate giant CTAs on the cover and all four sections.

**Critical meaning:** free association (`Join society`) vs fixed-term membership (`Buy membership` or `Get free membership`) use different labels and badges. An already joined user sees `Joined` and a safe Leave action in their personal society list, while active entitled free/paid terms are independently shown as `Active membership`. Do not show private contact/member lists, earnings or internal policy fields. **Branding:** cover/logo are custom; navigation/checkout/status colours stay Thunderstrux purple and semantic. **Mobile:** cover precedes title; 4 scrollable tabs with visible active underline; event cards stack; primary join button below description, not over photo. **States:** no public events/offer/merch - hide that preview with purposeful state; no unlisted/private leakage. **Trace:** T08/T09/T24-T26, PUB-05.

## PUB-06 - Society memberships `/societies/[orgSlug]/memberships`

**Layout:** slim society header plus H1 “Memberships”, honest explanation that offers are for a **fixed period**, benefits and prices. Main offer grid 1-2 columns, up to 3 if content is short; each `MembershipOfferCard` has product title, real start-end range, plain description, benefits list, cost, status (Eligible, Active, Upcoming, Expired), and a single CTA. If only one offer exists, use an **asymmetric split card**: left story/benefits, right term/price/CTA. No three identical pricing-column SaaS pattern for one product.

**Rules visible:** purchases require verified member account. No “automatic renewal”, “monthly subscription”, lifetime perk or unsupported stacked tier choice. Free society join is not an active paid grant. An active term links to `My memberships` rather than a duplicate Buy CTA; a genuinely available next term can show `Renew for next term`. **Mobile:** benefit text before price decision, one CTA, no sticky purchase button over support information. **States:** no current offer, future-only term, overlap denial, expired, pending payment with no entitlement, revoked due to confirmed refund. **Trace:** T22-T24; PUB-06/BUY-05/PER-03.

## PUB-07 - Society merchandise `/societies/[orgSlug]/merchandise`

**Layout:** title “Merchandise” with adjacent honest `Pickup only` tag; a short pickup location/contact row near the top. Product grid uses high-quality 4:5 product images with pale neutral backdrops, 3-4 columns desktop and 2 on mobile where 160px minimum card width fits. Product name, `From A$...` when variants legitimately have different prices, stock if appropriate, and a small size/colour options description. Do not overlay everything on glossy gradients.

**Navigation:** persistent society context; basket icon has live society-specific count, not combined cross-society cart. Products open PUB-08; checkout remains merchandise-only. **States:** zero products, sold-out variants, archived hidden, asset fallback; filters only for actually supported catalogue fields. **Trace:** T25-T26, PUB-07.

## PUB-08 - Merchandise product detail `/societies/[orgSlug]/merchandise/[productId]`

**Desktop:** gallery on left 55%, product name/price/options and purchase actions on right 45%. Gallery has one large image and up to four thumbnail controls only if actual images exist; object-contain for full garment view; descriptive alt and keyboard change. Right: name, product description, genuine pricing, radio/group selection for variant (size, colour), available quantity, quantity stepper, total from quote, `Add to merch basket`. A visually bordered pickup information block sits **above** any checkout path.

**Mobile:** photo, title, price, variant labels/controls, quantity, pickup explanation, sticky or inline Add CTA. No tiny colour-only swatches; always show text colour names and selected state. Invalid/unavailable variants show reason instead of disappearing. If variant changes in another session, re-quote before adding; don't promise stock from stale UI. **States:** draft/archived concealed, temporarily unavailable, all variants sold out, changed price, pickup information missing (publication blocker), gallery image fails. **Trace:** T25-T27, PUB-08/BUY-06.

---

# 6. Identity, authentication and sensitive account pages

Authentication pages use a common `AuthShell`: 40px margin above a 440px-wide white card against warm-paper/pale-violet canvas; compact Thunderstrux logo and purposeful tiny edge of editorial purple at left/top, **not** an illustration that crowds the form. One H1, short guidance, labelled fields, primary action full width, recovery/help link and correct accessible errors. Marketing decoration is deliberately secondary to trust.

## AUTH-01 - Sign up, sign in and choose account type

**Sign in:** title “Welcome back”, email, password, inline show/hide password control, “Forgot password?”, purple `Sign in` action and `Create account` secondary link. Support valid Auth.js and existing provider flows only; do not invent Google OAuth buttons if the app doesn't support them. If purchase initiated before login, display small note `You'll return to [event/society]` using safeReturnPath.

**Register:** visible two-step content if needed: choose `I'm joining as a member` vs `I'm setting up a society`, then minimal signup details. Radio cards are distinct but not a fake `AccountRole` permission override. Progress and verification requirement are clear. **Mobile:** 16px field text avoids zoom; card full width with 16px exterior margin; no inaccessible two-panel marketing layout. **Variants:** duplicate email generic safe handling, password requirements, rate-limit with Retry-After, auth error, unverified but signed-in restricted action, session revoked. **Trace:** PRD 6.1, T03-T05, AUTH-01.

## AUTH-02 - Verify email pending, resend, confirm

**Pending:** prominent small envelope outline + H1 “Check your email”, masked or safely rendered address, 2 lines: verify to continue, actual token expiry only where source confirms. Controls: `Resend verification email`, `Change email` where enabled, `Back to sign in`. **Confirmed:** server-confirmed badge, button to continue to safe intended destination. **Failed:** used/expired/wrong-purpose generic notice, request new link.

**Security layout:** remove distracting social links; never put raw verification token in screenshot, log, analytics or DOM after redemption. Link preview/GET **must not consume** token; POST performs action [T03/T04]. **Mobile:** same single-column. **States:** resend cooldown, 429, provider temporarily unavailable, token consumption race and already-confirmed. **Trace:** T02-T04, AUTH-02.

## AUTH-03 - Password recovery, email change confirmation, permanent closure

**Forgot password:** email-only 440px card, neutral “If an account exists, we'll send instructions” confirmation. **Reset password:** new password and confirm, requirements, reveal toggle and submit. No automatic login after reset. **Email change confirm/cancel:** compact security-focused card, explain old address remains active until confirmed, never show or leak raw token; success triggers sign-in if session invalidated. **Permanent closure:** do not design as an innocent red text link only. Account settings opens a separate high-friction review page showing what cannot be deleted (historical financial/attendance records), blockers (active owner, unresolved orders), current password/MFA and final explicit acknowledgement. Destructive confirmation only after server eligibility check.

**States:** expired token, consumed token, password mismatch, MFA required, other session revoked, closure blockers with links to appropriate tools, provider unavailable. **Trace:** T04a/b/c and AUTH-03.

## AUTH-04 - Account profile and security `/account/settings`

**Layout:** `PersonalShell` or secure settings sub-navigation: `Profile`, `Security`, `Email`, `Close account`. Main form max 680px, anchored sections separated with 1px rules rather than dozens of purple cards. Profile name and editable fields first; email verification badge and resubmit controls; change password separate from email change, each with current-password/MFA form. `Close account` is last in a shallow danger panel with clear irreversible impact.

**Interactions:** optimistic version is never visual permission; success can use toast **plus persisted field feedback**. On reauth/stale session, return to sign in with safe path and avoid leaking private profile in background. Desktop subnav left, mobile select or anchored menu; keyboard focus preserved. **States:** verified/unverified, pending email change, token request, stale auth session, disabled identity, 409 conflict. **Trace:** T03-T05, AUTH-04.

---

# 7. Buying and purchase recovery screens

Purchase screens must be conservative about truth. **Design rule:** “Review” is not payment, redirect return is not paid, “Paid” does not always mean fulfilled, free acquisition must not open Stripe, and refund request is not confirmed refund. Keep order type explicit throughout. [SRC-PLAN §§3.2-3.4; SRC-FLOW §§9-10]

## BUY-01 - Ticket selection (PUB-03 panel or accessible sheet)

**Composition:** heading “Select tickets”, event name/date mini-header, item rows separated by a fine border. Each row contains title, availability, standard price and member price if relevant, short eligibility explanation, a 44px minus button / live quantity / 44px plus button. Sticky footer inside sheet shows server-quoted line and `Continue`. The flow defaults to **one type per order**; never let users create apparently valid multi-ticket-type totals unless the actual order schema handles them.

**Eligibility visuals:** locked member price appears as secondary explanation `Members A$... · Get membership`; only actual active, verified term receives eligible total. Guest cannot proceed under restricted price. **States:** sold-out row, free row, closed sale, qty cap, quote conflict requiring updated review, staff charge-unready while free option available. **Mobile:** bottom sheet is 100% wide with title, scrollable rows, summary/footer outside scroll area, body scroll lock and focus restoration. **Trace:** BUY-01, T12-T16/T24.

## BUY-02 - Guest email verification (proposed guest route)

**Composition:** `CheckoutShell` with small stepper `Tickets > Verify email > Review`; H1 “Continue as guest”, email field, `Send verification link` and an adjacent but subdued `Sign in instead`. Copy explains **why** a verified email is necessary to access private tickets. Confirmation uses consistent check-email screen without account creation. After POST verification, re-quote original item and return to Review; any stock/price change gets an inline conflict, not silent purchase.

**Security:** no unauthorised view from someone typing another email, no prior-order access merely from guessed ID, no confirmation token shown in URL query analytics. **States:** success, expired, delayed email, resend, 429, abandoned and return path recovery. **Mobile:** single-column, keyboard not covered by a fixed CTA. **Trace:** T16, BUY-02.

## BUY-03 - Ticket checkout review (proposed order-review route)

**Visual:** calm 7/5 two-column layout with `<main>` form left and persistent `MoneySummary` right. At top title “Review your tickets”, actual event image thumbnail + date/venue/time zone. Display buyer contact, only collected required details, selected ticket type/quantity, immutable quote version or “price checked just now” if actually returned by API, seller, refund policy, subtotal, real fees and total. A small editable text link returns to selection safely. The final button says `Pay A$XX.XX with Stripe` or `Confirm free registration`. Show `You'll continue to Stripe's secure checkout` for paid amounts. **No card entry fields on Thunderstrux.**

**After pressing:** disable double submit and show neutral “Preparing secure checkout”; idempotency/recovery controlled by server. When 409 quote changed, replace final CTA with `Review updated price`, outline changed rows in warning colour and require user acceptance. **Mobile:** collapse summary but total remains visible; do not hide final seller/policy information. **Trace:** T13-T16/T17, BUY-03.

## BUY-04 - Ticket purchase status and receipt

**Layout:** a single centered max 760px result panel. **Server `pending/uncertain`:** neutral/information heading “Checking payment status”, short plain explanation, order reference, bounded `Refresh status` / automatic limited polling, support if long delayed; **no green tick**. **Fulfilled paid:** dark-violet top rule, small green confirmation icon with literal “Tickets issued”; below one `TicketFace` per unit, `View my tickets` or secure guest `View tickets`, itemised receipt, seller and real refund policy. **Free fulfilled:** “Free registration confirmed” and `Free` marker, no Stripe imagery.

**Failure/expired:** clear whether a definitive failure is known. If outcome uncertain, do **not** assure “you were not charged”; direct to tracked support and safe recovery. **Compensation:** warning “Payment received but tickets could not be issued. Under review.” Link help; no printable valid ticket. **Refunded:** show verified refund state and void ticket truth, historical order accessible. **Mobile:** ticket details stack, receipt numbers align, no horizontally clipped ticket edge. **Trace:** T10/T14/T18/T19, BUY-04.

## BUY-05 - Membership checkout review + result

**Review layout:** society crest, membership product title, fixed dates, **No automatic renewal** badge, enumerated real benefits, price (or Free), current coverage and **new coverage**. CTA uses `Buy membership` or `Get free membership` then external Stripe only for payable order. Purchaser must be a **verified member**. No guest offer, no subscription UI, no plus/minus quantity selector for membership terms.

**Result:** server-confirmed grant and its start date. If term starts in future, display `Upcoming - benefits begin [date]`; while Stripe pending, show `Payment processing - no membership granted yet`. A confirmed full refund renders `Revoked` in My memberships while order receipt remains. **Responsive:** narrow reading form, summary beneath on mobile. **Trace:** T22-T24, BUY-05.

## BUY-06 - Society merchandise basket

**Visual:** 8/4 desktop content to summary. Title `[Society] merchandise basket`, `Pickup only` badge; line rows contain 88x110 image thumbnail, name, size/colour, price, plus/minus, Remove, line total. Keep one-society checkout visible in heading and row seller; no ticket/membership tabs inside basket. `Order summary` at right shows pickup location/instructions and total. CTA `Checkout merchandise`.

**Limits:** max 10 distinct product variants/lines, 10 units per line, merged identical variants. Over-limit shows focused inline message, not a broken silently clipped stepper. Price/availability come from current server quote, with edits and removal on 409. Cross-society attempt shows explicit choice to finish existing society basket or clear it, not automatic merger. **Mobile:** line rows stack thumbnail left/details right, then quantity and line total; summary accordion with total always visible. **Trace:** T26-T27, BUY-06.

## BUY-07 - Merchandise checkout, result and order tracking

**Review:** 7/5 layout like ticket checkout, but include pickup address/hours/contact and **“No delivery available”** before final payable CTA. Every variant/quantity confirmed with server quote and society seller. Buyer may be verified member or verified guest; no shipping field. Free merchandise total, where supported under T27, completes as a local free order.

**Result/tracking:** separate **Financial status** (`Payment processing / confirmed / refunded / under review`) from **Fulfilment** (`Preparing / Ready for pickup / Collected`) with two labelled status rails, not a single misleading `Done` badge. Once ready, show collection instructions and who to contact, never an invented QR collection code. `Collected` retains date/actor where authorised. Refunded goods do not imply physical return or stock restoration. **Mobile:** first card shows collection status and next action; line history below. **Trace:** T26-T29, BUY-07.

## BUY-08 - Recover a guest purchase

**Layout:** 440-600px centred security card inside restrained shell. H1 “Find your guest purchase”, verified email request and generic sent message; no open search by order ID. After scoped token claim, show only the permitted ticket or merchandise purchase receipt, not every order that email may have made. Links contain no reusable unscoped credentials. Clear support path for lost inbox access **without promising automatic manual recovery**.

**States:** no matching email (same generic sent response), wrong-purpose token, expired/revoked, already claimed, order now refunded, guest access out of scope, request rate limited. **Mobile:** single-column. **Trace:** T16/T29, BUY-08.

---
**Free cancellation presentation:** Follow PLAN section 3.3 and FLOW section 9.6: use `Cancelled - free purchase` with invalid/revoked entitlement or blocked future pickup, retain historical facts and show a cancellation notice. No provider refund amount or `Refunded` badge. In ORG-08 the authorised action is `Cancel free purchase` with whole-order consequences; stock restoration uses the separate reviewed action.

# 8. Member dashboard and personal pages

Personal pages use `PersonalShell`, not the dark admin sidebar. Tickets, entitlements and purchases are separate first-class objects: being a member does not equal holding a ticket, and buying merchandise does not equal collecting it.

## PER-01 - Personal overview `/dashboard` in personal context

**Visual order:** slim violet-tinted greeting `YOUR NEXT PLANS` + upcoming valid ticket as a **feature card** with image on left, event name/date on right and one `View ticket` CTA. Under it: “Your memberships” horizontal compact offers/grants; “Societies you follow” society avatars and `Explore events`; “Recent purchases” simple dated rows; account-verification notice only if relevant. Do not cover the page in four unrelated metric tiles.

**Mobile:** upcoming ticket feature becomes vertical, action visible without extra accordion. **No-ticket state:** primary link `Explore events`, separate empty state for no active membership or joins; pending paid order appears in Purchases/recovery, **never** as a valid upcoming ticket. **Trace:** T19/T24/T29/T34, PER-01.

## PER-02 - My tickets `/tickets` (stable)

**Header:** H1 “My tickets”, sub-tabs `Upcoming / Past / Invalid or refunded` and society filter if supported. Event rows use a **date-first** design with one or more `TicketFace` units on expansion/detail. Each ticket includes event date/location/timezone, original purchased ticket type, validity and check-in status, unique server ID, link to receipt. `View ticket` opens full event-day detail, not a made-up scanner QR. A multi-quantity order shows each unique ticket unit separately while grouping under its order.

**Mobile:** ticket edge full width, 44px actions, no overlapping venue text. **States:** checked in, not yet checked in, invalid, refund review, no upcoming tickets, event changes, guest ticket lives on guest-scoped page rather than forced member wallet. **Trace:** T10/T19, PER-02.

## PER-03 - My memberships (proposed personal route)

**Header:** H1 “My memberships”; tabs or segmented filters `Active / Upcoming / Expired / Revoked`. Cards with society avatar, product, start/end displayed in society time zone, verified benefit summary, clear state badge and `View purchase`. `Renew for next term` only appears when eligible term exists and no prohibited overlap is present. Information box: “Memberships do not renew automatically.”

**Mobile:** one-column cards with full term range; active state must not rely on date display computed from user's browser timezone. **States:** free join with no paid grant should not be listed as paid term, refunded revocation, overlapping term denial, stale entitlement. **Trace:** T22-T24/T34, PER-03.

## PER-04 - Joined societies (existing pattern, canonical route [V])

**Layout:** H1 “My societies”, small explanatory line `Following a society is different from purchasing its membership`; list of society cards with `Joined since`, separate `Membership active` badge where true, quick `View events`, `Explore membership`. `Leave society` uses a secondary or overflow action and explains what leaving does **not** cancel: paid membership term/staff appointment. **Mobile:** cards stack, actions remain labelled.

**States:** no joins, leave failure, account unverified, society removed/renamed with stable historical connection; no private staff management from join. **Trace:** T09/T34, PER-04.

## PER-05 - Purchases and detail `/purchases`, `/purchases/[kind]/[id]` [proposed]

**Index:** H1 “Purchases” and clear tabs `Tickets | Memberships | Merchandise`, plus status filter; no fourth “All types” unless backed by intentional mixed cursor aggregation. Desktop rows show date, society, short product summary, amount/Free, **payment and fulfilment states** separately, reference and Open. Mobile rows are card definitions; sort order descending stable server cursor.

**Detail:** compact purchased-snapshot heading, itemised receipt, seller, currency, fee policy, actual amount, server timeline, linked entitlement (tickets, membership term or pickup stage), applicable support/refund information. Crucially, newly edited ticket names/prices do **not** rewrite this receipt. Refund processing includes amount/status and any manual review. Don't render raw Stripe data, emails of other buyers or secret tokens.

**States:** pending/failed/expired/free confirmed/paid fulfilled/compensation review/refund requested/refunded/external partial-refund review, archived merchandise/history, unauthorised order concealed. **Trace:** T10/T18-T20/T29, PER-05.

---

# 9. Organisation and staff pages: complete design coverage

## ORG-01 - Society operations overview `/dashboard` in staff context

**Page heading:** H1 `[Society] overview`, smaller last-updated/timezone context. The first row is **“Needs your attention”** (readiness blockers, overdue pickups, issues) rather than a shiny KPI carousel. Use an elegant two-column desktop grid: main `Upcoming events` editorial list and `Recent actions/orders` secondary; top 2-3 qualified metric tiles such as Upcoming events, Issued valid tickets, Pending pickups **only when supported**. Additional financial tile only if **finance permission** and source DTO truly supplies it. Primary CTA `Create event` for eligible actors.

**Visual:** white content, plum sidebar, purple rule and restrained statistic numbers. Event manager sees non-financial activity; finance sees authorised financial information; door volunteer sees check-in task landing, not earnings. `Set up Stripe` is a task only if needed for paid sales, not an error for free event creation. **Mobile:** attention banner, next event and action before any charts. **States:** fresh society onboarding checklist; no upcoming events; charges unready; financial unknown (Not available, not 0); revoked role leads to personal context. **Trace:** T05/T08/T17/T34, ORG-01.

## ORG-02 - Create society / onboarding wizard

**Screen:** step indicator anchored near title with real labels `Identity > Appearance > Operations > Team > Payments > Finish`, using actual route flow and resumable server state. Each step shows **one main form card** with a 6-8 column editing area and an optional 4-column live preview/instruction; not a separate huge gradient panel. Bottom has `Back`, `Save and continue` and truthful `Skip for now` only for skippable fields.

**Identity:** official society name, stable proposed slug, <=5000-char description and public support email. **Appearance:** upload logo and banner (JPEG/PNG/WebP <=5MB, <=4096x4096 after server validation); preview public cover and mobile crop. **Operations:** timezone field with default `Australia/Brisbane`, refund/support/pickup public policy. **Team:** named owner and optional invite, no shared password. **Payments:** Stripe Connect button and distinguish Charges enabled, Payouts enabled, Details submitted; optional to proceed with free event. **Finish:** checklist with `Profile ready`, `Can publish free events`, `Payment account ready` (only if true), `Invite your team`.

**Mobile:** single step/form per view, bottom action visible, never overflow long slugs. **States:** saved partial onboarding, slug conflict, upload rejected, MFA needed, stripe incomplete, duplicate organisation account prevented, concurrent version conflict. Do not infer creation of a second primary organisation. **Trace:** T05-T08/T17, ORG-02.

## ORG-03 - Events management index `/dashboard/events`

**Composition:** breadcrumb, H1 “Events”, CTA `Create event` at upper right. Beneath title, a slim filter bar `Upcoming / Drafts / Past / All`, text search and visibility/status filters where implemented. Desktop table columns: thumbnail+name, local start/date, visibility, **publication state**, **sale state**, valid issued units, action. Use separate badges for `Published` and `Sales closed`; published does not equal on sale. Sort header label/arrow and pagination in bottom toolbar. `Edit` and `Preview` directly accessible; potentially destructive actions inside labelled overflow with permission check and reason.

**Mobile:** card rows with date, title, status chips, View/Edit. **States:** draft missing ticket type; sold-out; published but paid charge not ready; unpublish blocked due to sales; no events; foreign event 404. **Trace:** T11-T15/T34, ORG-03.

## ORG-04 - Create/edit event builder `/dashboard/events/new`, existing edit route [V]

**Distinctive design:** not a giant generic settings form. Desktop has a **220px vertical chapter navigation**, a 660-760px form reading column and an optional 280px readiness rail. Persistent heading `Create an event` or event name, small truthful `Unsaved changes`/`Saved at HH:MM` indicator. Navigation sections: `1. Basics`, `2. Date & place`, `3. Tickets`, `4. Access & sales`, `5. Review & publish`. A `Preview` action in header opens draft-only authorised preview; always show a visible watermark `DRAFT PREVIEW - NOT BOOKABLE`.

**1. Basics:** event title, short summary, safe description editor, event image uploader (supported asset pipeline), immutable host display. A large example-preview illustration is unnecessary. **2. Date & place:** date/time in society IANA zone with explanatory zone next to fields, venue/location, optional event capacity distinct from ticket stock. **3. Tickets:** repeatable but **not copy-pasted generic cards**: each ticket row has name, price A$, quantity remaining and historical sales constraints; member price only when T24 entitlements are supported. Sold ticket type cannot be deleted. **4. Access & sales:** visibility (`Public`, `Unlisted`, `Members only` only when enabled), sales close time, real fee/refund policy. **5. Review:** annotated buyer-page preview and canonical `ReadinessChecklist` with each blocker linking to source field. CTA `Publish event` only when backend confirms required checks.

**Sticky builder footer:** `Save draft` on left, `Continue` or `Publish event` on right. Prefer explicit save if autosave cannot be safely reliable; never fake an autosave tick. Confirm leaving with unsaved edits. **Mobile:** chapter selector becomes `Step N of 5`, single-column form, readiness checklist at Review and anchored Save. **Conflict:** code/plan readiness source is authoritative; 409 stale edit shows Compare/reload without destroying local input. **Trace:** T07/T10-T12/T17/T24, ORG-04.

## ORG-05 - Event management workspace `/dashboard/events/[eventId]` [proposed grouping]

**Header:** event thumbnail, name, current schedule, `Published`/`Draft` and sale state badges (separate), `Preview` and `Edit event`. Direct links to **one canonical** event. Use true secondary navigation `Overview | Tickets | Attendees | Orders | Check-in | Analytics`, gated per capability.

### Overview tab

Desktop main left: small schedule/venue card, publish readiness/sales info and valid ticket unit totals. Right sidebar: `Open public event`, `Share event` (copy existing URL), `Create change notice` only if workflow supported. Lower section shows recent scoped history. No “View public” for a draft that leaks its private URL; preview uses staff-authorised mode.

### Tickets tab

Desktop structured table with ticket type, face price, real member price, remaining quantity, active holds, *sellable* and last edit context, with inline safe edit action. Show `Remaining stock` and `Sellable now` as different concepts. At capacity, availability derives from holds+issued and event ceiling. Add/edit opens form in consistent drawer or dedicated page; sold historical types archived rather than removed.

### Attendees tab

Search and filter by `Not checked in`, `Checked in`, `Invalid/review`; read-only row identity, ticket type, attendance and minimal permitted buyer details. No visible financial totals to check-in-only role. Filters use actual ticket validity, not status of payment return URL. Export only if actually implemented and authorised.

### Orders tab

Scoped order rows and detail; `Paid and fulfilled`, `Pending`, `Failed`, `Refund review` explicitly named. Open shared ORG-08 order detail, avoiding a second incompatible refunds UI.

### Check-in tab

Links to full-width ORG-06 console rather than shrinking door tools into an analytics column.

### Analytics tab

Same definitions as ORG-13; event manager sees attendance/inventory only; finance-only money comes from correct scoped service. **States:** draft, sold-out, closed sales, unpublish blocked by existing orders, stale schedule, missing permission. **Trace:** T11-T19/T31-T32, ORG-05.

## ORG-06 - Event-day check-in console (nested event route [V])

**Design for a door, not a dashboard.** Main event banner is a **single 60px plum top strip** with event title, actual date/location and selected society. Beneath: large 52px search field with autofocus only after user has opted into scan/search, labelled `Search ticket, name or order reference`; never auto-open mobile keyboard on arriving at event. Show connection indicator `Online / Connection lost - check status` and time of last server check where available.

**Result row:** maximum key facts: attendee display name, ticket type, partial safe order reference and validity, current check-in. Primary `Check in` 52px high solid brand. After success turn row into anchored `Checked in at 18:42` state with actor/time and green text; an already checked in result is a different warning, not a second success. Offer explicit `Check out` only to roles with actual permission. Search next attendee stays immediately available after server acknowledgement. Do **not** put QR scanner, fake barcode or offline mode anywhere as a live affordance.

**Mobile:** full-screen search + results, 16px text, 52px controls, no floating multi-panel. **Failure:** request timeout -> **Status unknown - refresh before admitting**; two staff trying same ticket -> one success, other sees `Already checked in`; wrong event/void/refunded/review/foreign = clear denied result without leaking other society details. **Trace:** T10/T19, ORG-06.

## ORG-07 - Organisation calendar `/dashboard/calendar`

**Layout:** H1 “Calendar” with society timezone label prominent beside `Today`, `Previous`, `Next` and view segmented control `Month | Week | Agenda`. Desktop month grid has 7 columns, compact 12px weekday headings, event chips in violet and faint purple; drafts have dashed border/`Draft` text for authorised managers, published solid; multi-day event draws actual date span, not made-up recurrences. Clicking entry opens canonical event workspace. **Do not place money/booking on calendar cells**.

**Week:** accessible horizontal times/days grid with today marker, hover/focus detail popover with event name/time only. **Agenda:** chronological dated event rows and is **default mobile view**; tiny seven-column calendar must not be squeezed into 320px. Date and timezone constraints come from source, range <=93 days, no invented Google/Apple calendar sync, no public feed, no consumer calendar. **Access:** check-in-only staff see published operation items only, never private drafts/finance; managers see drafts. **States:** DST boundary, overnight/multi-day event, empty month, out-of-range selection and denied event. **Trace:** T33, ORG-07.

## ORG-08 - Society Orders list and order details `/dashboard/orders`

**Visual:** H1 “Orders” with **three clearly separated family tabs** `Tickets | Memberships | Merchandise`, not an ambiguous universal mixed order. Global status/search toolbar with status specific to selected family. Desktop columns: date, safe order reference, purchaser (only permitted), contents, amount/Free, payment/fulfilment status, Open. Money and buyer details disappear from server DTO for staff without finance/appropriate order capability, not merely hidden in CSS.

**Order detail:** main column with immutable purchased item snapshots, timeline, current validity/term/pickup status; right rail with payment state, provider-verified refund progress where permitted, relevant contact/notice status. `Refund whole order` destructive button opens specific confirm with amount and consequences. **Do not** introduce arbitrary partial refund editing or manually set Paid. **Mobile:** cards with status labels and a dedicated detail route. **States:** free order, pending provider, late/uncertain paid, compensation review, confirmed full refund, external partial-review, archived product. **Trace:** T18/T20/T29, ORG-08.

## ORG-09 - Membership product management `/dashboard/memberships`

**Layout:** H1 “Memberships”, segmented tabs `Offers | Member terms | Sales` based on capability. Offers shown as a **table of term products**, not generic software subscription cards: product name, fixed start/end range, price, status and purchased/active count (where authorised), action `Edit`. `Create membership offer` opens full form or focused right drawer with name, description, start/end in society timezone, one-off price, benefits/entitlement scope and visibility. State/version notice explains changes to future offers don't rewrite issued grants. Avoid manual recurring-billing toggles.

**States:** already active overlap restriction, upcoming term, completed/archived product, free offer, no products, payment account not ready for paid product, purchaser email not verified. **Mobile:** clear summary cards and full-width edit form. **Trace:** T22-T24, ORG-09.

## ORG-10 - Membership roster, individual term detail and society members

**Roster:** H1 “Members” or `Membership terms`, with explicit filters `Active | Upcoming | Expired | Revoked` and separate `Free joins` view. These are **different datasets**. Table of authorised person, free/paid membership product, date range, entitlement state, linked purchase, actions. A small definition explains “Joined society” is a free association, **not staff** and **not a paid membership**.

**Individual term detail:** immutable term/start/end, source order, current grant state, refund/revocation record, benefits, event eligibility context. Don't display `Renew automatically`. Any manual change must be server-supported and audited, otherwise read-only with appropriate contextual link. **Mobile:** searchable roster cards with period displayed on two lines. **States:** no roster, expired, future, refunded revoked, archived society product, no access. **Trace:** T09/T22-T24, ORG-10.

## ORG-11 - Merchandise products, variants and stock `/dashboard/merchandise`

**Layout:** H1 “Merchandise”, tabs `Products | Orders & pickup | Stock adjustments` gated by capability. Products index blends small genuine thumbnails with sortable rows: product, publication, SKUs/variants, remaining stock, price, updated. CTA `Add product`. Form has natural section sequence `Details -> Images -> Variants -> Pickup information -> Review & publish`; variation table supports size/colour/price/stock and clear SKU identity. **No shipping page**. Image uploader adheres to T07; warn on missing pickup info before publish.

**Stock editor:** direct edit requires actual server bounds, old/new value and reason where action warrants; cannot shrink below active holds or sellable constraints. Sold historical variants can archive, not disappear from old receipts. **Mobile:** thumbnail products with Expand to variations; large review and save buttons. **States:** draft, sold out, archived, variant SKU duplicate, malicious/oversized image, stale quantity, stock concurrent purchase. **Trace:** T07/T25-T27, ORG-11.

## ORG-12 - Merchandise pickup and returns queue

**Task-first design:** simple H1 “Pickups”, `Awaiting preparation | Ready | Collected` tabs, clear pending count based on real fulfilled orders. Rows show order reference, product/variant/qty, purchaser contact **only to authorised fulfilment actor**, current collection state and action. `Mark ready for pickup` button asks for actual state change and triggers transactional notice. On pickup, an explicit `Mark collected` confirmation shows order/item list, timestamp/actor after server ack; do not show QR redemption unless implemented.

**Return view:** logged return reason and quantity; restock is an **audited separate action** and not automatically inferred from refund. Collected-but-refunded is a truthful dual-state row. **Mobile:** 52px action targets, search and current pickup instructions; no decorative cards around each line. **States:** fulfilment pending (ineligible), uncertain processing, already collected, parallel volunteer action, partial-return review, foreign order concealed. **Trace:** T28, ORG-12.

## ORG-13 - Analytics `/dashboard/analytics`

**Visual:** factual report, not flashy SaaS chart gallery. H1 “Analytics” with a prominent labelled **as-of/time range** and society timezone. Primary tabs `Overview | Events | Memberships | Merchandise`. At top display up to three summary totals matching authorisation: gross paid sales, verified refunds, net receipts **only to finance + analytics actors**; event managers see `Issued tickets`, `Checked in`, `Attendance rate` rather than money. A 2-column chart/table pair enables evidence inspection. Chart colour follows purple primary, ink secondary, semantic green/amber for true states.

**Details:** ticket paid/free issued, by type, attendance, order trends, member grants active/upcoming/expired, merchandise paid lines and pickup status. Each metric has explanatory hover/focus tooltip with denominator and exclusions; avoid “Profit”, “Bank balance”, “Payouts” inferred from Stripe charges. Accessible equivalent real data table with same filters. Empty/undefined metric is `No data` / `Not available`, not fabricated 0.00% when denominator zero. **Mobile:** metric cards single/two columns, charts horizontally simplified but underlying table remains accessible. **Trace:** T31-T32, ORG-13.

## ORG-14 - Payment account and Stripe readiness (existing settings section/proposed standalone)

**Layout:** H1 “Payments”, slim “Payment setup” panel with a **four-row readiness list** rather than a green single “Connected” pill: `Charges enabled`, `Payouts enabled`, `Details submitted`, `Action required`, each with current provider-backed state and updated-time. CTA `Connect Stripe` / `Continue setup` / `Review account`. Explain payment platform fee withholding only from validated policy and do not invent actual Stripe payout dates, card processing costs or settlements.

**Safety:** disconnect is a low-emphasis destructive action in account section, guarded by permission/MFA/server blockers and full explanation about pending financial obligations and preservation of original provider linkage. Free event publication can still be possible without charges as source rules allow. **Mobile:** single column statuses. **States:** disconnected, setup incomplete, charges enabled/payouts disabled, disabled, pending review, unavailable provider, disconnect blocked. **Trace:** T17, ORG-14.

## ORG-15 - Staff, invitations, roles and committee handover

**Layout:** H1 “Team & access”, upper action `Invite staff` with clear permissions explanation. Table rows: name, invited/verified email (appropriately redacted), **role label**, accepted/pending/expired/revoked, MFA indicator where permissible, last action, Manage. Invite form uses one-column email + role radio/list and expiring invitation explanation; **never display raw invite token**. Role chooser shows human-readable allowed actions grounded in current `rolePermissions`, not unchecked local permission arrays.

**Handover:** a dedicated full-width staged page `Choose new owner > Verify recipient > Review impact > Confirm transfer`; purple timeline/danger amber warnings, exact new owner identity and final confirmation. Explain last-owner protections and staff context transition. Staff revoked during session sees explicit “Your access to this society changed” and safe return to Personal. **Mobile:** invite drawer/full page, table rows as cards; actions not hover-only. **States:** pending/revoked/racing invite, email mismatch, owner handover collision, MFA required, last owner cannot be removed. **Trace:** T05-T06, ORG-15.

## ORG-16 - Organisation profile, branding and general settings `/dashboard/settings`

**Layout:** anchored left settings nav `Public profile | Branding | Support & policies | Timezone | Organisation details` and single 680px editing region. Reuse society public-cover preview at right (where width allows) with explicit `Preview as visitor`. Logo and hero crop controls respect uploaded safe assets; show fallback on missing imagery. Public description <=5000 characters from schema, support email and actual pickup/refund policy fields. Stable slug is shown with caution; don't add a casual rename field if product forbids it. Dates/timezone updates explain impact on displayed local times but do not silently rewrite historical purchases.

**Permissions/state:** actual `organisation:settings` gate, optimistic `profileVersion` stale conflict with safe retry, no internal staff/audit/payment secrets on public preview. **Mobile:** setting sections accordion or top select, preview below editor and always reachable. **Trace:** T07-T08, ORG-16.

## ORG-17 - Activity history and audit `/dashboard/history`

**Layout:** a chronological “Society history” with filters by activity category/actor/date and a main **time rail**. Each entry uses timestamp in society timezone, action label, safe actor attribution, target object and before/after summary where allowed. Financial lifecycle events link out to actual order detail; don't pretend activity stream is full accounting journal. Unknown older entries use `Historical detail unavailable` rather than forged edit history.

**Mobile:** single vertical rail with wrapped long names, robust pagination. **Privacy:** no raw provider payloads, verification secrets, private buyer email, cross-society records. **States:** zero actions, missing old provenance, insufficient audit permission, pagination reload, archival visibility. **Trace:** T38, ORG-17.

## ORG-18 - OpenClaw `/dashboard/openclaw`

**Visual goal:** a contained first-party **operations assistant**, not a full-screen AI gradient toy. Desktop split: left 64% conversation/history, right 36% `What I can do`, `Sources and scope`, and **Action preview**. Header states `Working in [Society]` and current authorised staff role. Default starters are supported tasks only: `Explain publication blockers`, `Summarise ticket sales` (finance only), `List next month’s events`, `Create a draft event` and `Mark merchandise ready` when permitted. No fake “AI working in background” badge or computer-control affordance.

**Answer:** text grounded in source-linked internal objects, as-of and safe privacy handling. **Action proposal:** purple-bordered white card with exact society, actor, typed action, before/after values, expiry, warnings, separate `Review and confirm`/`Cancel`. Confirm only after backend preview and live re-authorisation; re-preview if stale. `Action completed` appears **only after durable execution receipt** and links result. Refund/owner/Stripe/disconnect/delete appear as navigation links to conventional privileged UI, never autonomous action buttons. Provider outage -> normal guided UI still works. **Mobile:** full-screen tab `Chat | Action details` rather than tiny side panel; confirmation modal with safe scrolling. **Trace:** T35-T37, ORG-18.

---
# 10. Annotated structural wireframes

These are **relative hierarchy sketches** (not pixel-perfect mock-ups). Build from the component and token contracts, not ASCII widths. Screens with complex states should use the variant matrix in section 11.

## 10.1 Home desktop (1248px content max)

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ THUNDERSTRUX             Explore events   Explore societies    Sign in       │
├──────────────────────────────────────────────────────────────────────────────┤
│ DEEP PLUM HERO (height determined by content; not full screen)               │
│                                                                              │
│  YOUR CAMPUS, LIVE                     ┌─────────EVENT IMAGE A────────────┐   │
│  Good things happen                    │ Actual campus event photograph   │   │
│  together.                             ├───────┬─────────────────────────┤   │
│  Find events and societies             │ B     │ C                       │   │
│  in one place.                         └───────┴─────────────────────────┘   │
│  [ Explore events ]  Discover societies                                      │
├──────────────────────────────────────────────────────────────────────────────┤
│ WHAT'S ON                                               See all events →    │
│ [ Search events, societies, dates                                  ]         │
│ [ photo / 16 OCT / Title / Host / Price ] [photo...]  [photo...]              │
│                                                                              │
│ FIND YOUR CROWD                                        Explore societies →  │
│ [ logo + real name + overview ] [logo...] [logo...]                         │
│                                                                              │
│ RUN A SOCIETY?  One clear paragraph.                  [Create a society]     │
│ Footer: support · policies · contact                                         │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Hierarchy notes:** photography authentic; no decorative chart; an event card appears quickly; desktop hero text left aligned. A dark plum hero uses white or warm-white text and chartreuse only for editorial micro-accent. Mobile removes mosaic competition and shows one photo after copy.

## 10.2 Event detail desktop / mobile

```text
DESKTOP                                    MOBILE (<768px)
┌──────────────────────────────────┐       ┌──────────────────────┐
│ Society > Event                  │       │ Header/logo      ☰   │
│ EVENT TITLE / Date · Venue       │       │ Society > Event      │
├────────────────────┬─────────────┤       │ Event title          │
│                    │ Tickets     │       │ Date · Venue · Zone  │
│    EVENT HERO      │ ----------- │       │ ┌──────────────────┐ │
│    REAL PHOTO      │ General ... │       │ │  event photograph│ │
│                    │ $.. [− 0 +] │       │ └──────────────────┘ │
│                    │ Member ...  │       │ About this event     │
├────────────────────┤             │       │ When and where      │
│ About              │ Total A$..  │       │ Tickets (inline)     │
│ When and where     │ [Get tickets]       │                      │
│ Hosted by          │ Support ... │       │ ┌──────────────────┐ │
│ Refund policy      │             │       │ │ From A$... [Get] │ │
└────────────────────┴─────────────┘       │ └──────────────────┘ │
                                         └──────────────────────┘
```

**Do not** place the desktop purchase panel after two screen heights of text. Sticky behaviour should have a clear top/bottom bound; the mobile bottom bar must disappear/hide when the real inline CTA is already visible and when keyboard/sheet interferes.

## 10.3 Society hub

```text
┌──────────────────────────────────────────────────────────────────────┐
│ [Organisation's photographic cover, no essential text burned in]     │
├───────┬──────────────────────────────────────────────────────────────┤
│ LOGO  │ Society name                         [Join society]          │
│       │ Description + public contact                                 │
├───────┴──────────────────────────────────────────────────────────────┤
│ Overview     Events     Memberships     Merchandise                  │
│ ━━━━━━━                                                              │
│                                                                      │
│ Next event [date rail + event]     Upcoming membership [fixed term]  │
│                                                                      │
│ Merchandise preview [product/photo] [product/photo]                  │
└──────────────────────────────────────────────────────────────────────┘
```

**Key difference:** `Join society` is separate from paid membership offer. The society's cover belongs to the society; interactive purple and security semantics belong to Thunderstrux.

## 10.4 Ticket checkout review

```text
┌────────────────────────────────────────────────────────────────────────┐
│ thunderstrux (small)                        Booking for [Society]      │
├────────────────────────────────────────────────────────────────────────┤
│ Tickets     >     Details     >     Review                              │
│                                                                        │
│ ┌────────────────────────────────┐ ┌────────────────────────────────┐  │
│ │ Review your tickets            │ │ Your order                     │  │
│ │ [Event image] Date / Venue     │ │ [Ticket type snapshot]         │  │
│ │                                │ │ Quantity                       │  │
│ │ Contact name                   │ │ Subtotal                       │  │
│ │ Verified email                 │ │ Fees (only actual values)      │  │
│ │                                │ │ ─────────────────────────────  │  │
│ │ Refund policy [read]           │ │ TOTAL      A$XX.XX             │  │
│ │ Edit tickets                   │ │ Seller & support               │  │
│ │ [Pay A$XX.XX with Stripe]      │ │ Refund/collection information  │  │
│ └────────────────────────────────┘ └────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

**No payment iframe/card input** unless technical plan is explicitly changed and approved. Free action uses `Confirm free registration`, not Pay or an empty Stripe stage.

## 10.5 Society operations desktop

```text
┌──────────────────┬─────────────────────────────────────────────────────────┐
│ [Society Logo]   │ Breadcrumb: [Society] > Overview            Account   │
│ Manage [Society] ├─────────────────────────────────────────────────────────┤
│                  │ [Society] overview                     [Create event]  │
│ RUN              │ Current context · timezone                            │
│   Overview       │                                                         │
│   Events         │ ┌───────────────────────────────────────────────────┐   │
│   Calendar       │ │ Needs your attention: 2 real tasks               │   │
│   Orders         │ └───────────────────────────────────────────────────┘   │
│ COMMUNITY        │                                                         │
│   Members        │ [Qualified metric] [Qualified metric] [Qualified metric]│
│   Memberships    │                                                         │
│   Merchandise    │ UPCOMING EVENTS              OPERATIONAL ACTIONS       │
│ UNDERSTAND       │ [dated rows w status]       [pickup / readiness]       │
│   Analytics      │                                                         │
│   Payments       │ ... (no fictional performance graph by default)        │
│ SETTINGS & TOOLS │                                                         │
└──────────────────┴─────────────────────────────────────────────────────────┘
```

**Permission nuance:** actual sidebar items and data differ by role, without content shifting into unlabelled icon-only menu. The seller who cannot see finance does not receive finance DTO fields.

## 10.6 Event builder desktop and check-in mobile

```text
EVENT BUILDER DESKTOP                        DOOR CHECK-IN MOBILE
┌───────────────┬────────────────┬────────┐  ┌─────────────────────────┐
│1 Basics       │ Event title    │READINESS  │ SOCIETY / EVENT       │
│2 Date & place │ [field]        │ ✓      │  │ 20 OCT · DOORS OPEN      │
│3 Tickets      │ Description    │ ✓      │  ├─────────────────────────┤
│4 Access       │ [field]        │ !      │  │ Search by name or ID    │
│5 Review       │                │        │  │ [                     ] │
│               │ Image          │        │  │                         │
│               │ [uploader]     │        │  │ Result: [Attendee]      │
│               │                │        │  │ General Admission       │
│               │ ...            │        │  │ Valid · Not checked in  │
│               │                │        │  │                         │
│[Save draft]   │          [Next]│        │  │ [    Check in        ]  │
└───────────────┴────────────────┴────────┘  └─────────────────────────┘
```

**Check-in safe failure:** after timeout show `Status unknown: check server before admitting`, *never* an optimistic green checked-in screen.

---

# 11. Screen states, shared error pages and critical UI truth

## 11.1 Canonical visual-state matrix

| Domain condition | Foremost visible label | Badge tint | Primary affordance | Forbidden affordance |
|---|---|---|---|---|
| Public published, on sale, sellable | `Tickets available` | Violet or neutral | `Get tickets` | Disabled-without-reason |
| Public published, sales closed | `Sales closed` | Neutral | `Contact organiser` if configured | `Pay now` |
| Free ticket selectable, paid Stripe not charge-ready | `Free registration available` | Neutral/info | `Get free tickets` | Block all sales because Connect is incomplete |
| Ticket stock exhausted | `Sold out` | Neutral | `See other tickets` if any | Fabricated waitlist |
| Draft event | `Draft` | Soft-neutral | `Edit` / authorised `Preview` | Public buy link |
| Event concealed by access policy | Safe not-found/access gate | Neutral | `Sign in` only where policy permits | Public title/description/private metadata |
| Buyer email not verified | `Verify your email` | Warning | `Resend verification` | Create reservation as anonymous identity |
| Checkout starts but provider state unknown | `Checking payment status` | Info | `Check status` / safe retry same operation | Green success / duplicate order |
| Free order committed | `Free registration confirmed` | Green | `View tickets` | Stripe payment request |
| Stripe paid + locally fulfilled | `Tickets issued` | Green | `View tickets` | Refund state hidden |
| Provider paid, fulfilment unsafe | `Payment under review` | Warning | `Get support` | Valid ticket / check in |
| Refund processing | `Refund processing` | Warning | `View status` | “Refunded” before provider verification |
| Full refund confirmed / void ticket | `Refunded - ticket invalid` | Danger | `View receipt` | Valid admission |
| Check-in succeeded, active ticket | `Checked in` | Green | `View details` | Repeat Check in |
| Check-in response timed out | `Status unknown - refresh` | Warning | `Refresh ticket status` | Success animation |
| Membership purchased, not started | `Membership upcoming` | Info | `View membership` | Active member discount today |
| Membership term active | `Membership active` | Green | `View benefits` | Invented auto-renewal |
| Membership expired or revoked | `Expired` / `Revoked` | Neutral/danger | Eligible next-term offer | Grant paid benefit |
| Merchandise paid, awaiting pickup prep | `Payment confirmed · Preparing` | Info | `View order` | `Collected` |
| Merchandise marked ready | `Ready for pickup` | Green | `View pickup instructions` | Shipping tracker |
| Merchandise collected | `Collected` | Green | `View receipt` | Automatic stock return |
| Goods refunded but physically collected | `Refunded · Previously collected` | Danger + neutral | `View return history` | Fake “returned to stock” |
| Role revoked | `Access to this society changed` | Warning | `Return to personal` | Keep management page visible |
| AI preview stale/expired | `Preview expired` | Warning | `Review changes again` | Execute old proposal |
| AI action executed with receipt | `Action completed` | Green | `View affected record` | Re-execute same action |

## 11.2 Standard application/system pages [D]

These are **required presentation states for existing route groups**, not permission to add additional backend products.

| Page | Exact layout | Actions and privacy |
|---|---|---|
| `404 Not found` | Minimal white public shell, small violet date-rail graphic, “We couldn't find that page” | `Explore events` or signed-in correct dashboard. Use **same concealment** for foreign/private order/event records when required; no leaked item title. |
| `403 Access denied` | Neutral account/society shell with plain message “You don't have access to this action” | `Return to Personal` or authorised prior route; don't reveal staff invite/secret details. |
| `401 Sign in required` | Auth shell with safe return path, “Sign in to continue” | Do not automatically force login on public event pages. |
| `409 Conflict` | Inline persistent panel: “Something changed since you opened this page” + changed fields if safely known | `Review updated details`, `Try again` only after re-quote/reload; never overwrite unknown newer edits. |
| `429 Rate limit` | Small amber notice, accurate server Retry-After when provided | Disable inappropriate immediate resend, accessible countdown text; don't leak enumeration. |
| `500/503` | Calm neutral error page, support reference if safe, `Retry` | Don't claim payment failed if provider result unknown; never show stack or secrets. |
| Maintenance/degraded notice | Inline full-width only if hosted ops actually indicate outage | Service status and recovery; no fictional uptime guarantees. |
| Loading/empty | Page-sized skeleton or specific empty state | Match real layout to avoid shift; true empty distinct from fetch failure. |
| Public help/contact | One-column clean informational page or authenticated link to genuine support route | Only link to configured addresses and actual policies; **do not invent a support phone, return policy, or SLA**. |
| Privacy/terms/refund explanation | Reading-width legal content with section anchors and last-updated metadata from approved policy | Source of truth must be real approved legal text, **not AI-generated product guarantees**. |
| Account closure outcome | Auth shell with plain final state, required re-login/closure result | Never retain a sensitive settings view after identity revocation. |

## 11.3 Reservation timer and sticky CTA conditions

- Show **30-minute reservation** countdown only **after** a server-established paid ticket or merchandise hold, based on returned `expiresAt`; do not start a browser timer on initial event view. This countdown is advisory; server decides expiry.
- A timer uses `time` element with accessible text “Reservation expires in…” and an absolute expiry tooltip; it must not be the only mechanism for user status. Expired/uncertain can only be resolved by server state.
- Don't show a ticket-type-only quote as fixed once user moves to membership purchase and back: always re-quote after entitlement changes.
- In mobile event/product pages, sticky buy bar appears after main inline button leaves the viewport, disappears when dialog or keyboard opens, and respects `env(safe-area-inset-bottom)`. It does not overlap last form field or footer, including at 200% zoom.
- Do not show a paid-total badge on an unavailable product, a stock badge from stale client state or an “Almost sold out” marketing tactic without actual reliable threshold.

## 11.4 Email design language for source-plan T30

While transactional emails are not web pages, they are part of the UX system. Create **one shared responsive email header** with small Thunderstrux mark, simple society attribution and purple 2px rule. Use table-based layout for client compatibility (max 600px), inline CSS and readable plain-text alternative. Body uses 16px text, a primary violet-linked button with descriptive text, the actual object snapshot and direct safe site URL. Preserve `Free` language for free tickets, fixed membership period and pickup instructions. Mandatory receipts, event-change notices, verification links, staff invites, refunds and pickup-ready notices use unique, honest templates; do not reword provider acceptance as inbox delivery. Buttons never contain raw reusable token in analytics; secure link delivery still follows server token rules. Email graphic flourishes must not resemble invoices from payment processors or disclose other buyers.

---
# 12. Accessibility, quality engineering and responsive acceptance

## 12.1 WCAG 2.2 AA is the minimum product target

Design and implementation must satisfy applicable WCAG 2.2 Level AA criteria, including accessible name/role/value; keyboard access and focus order; focus not obscured; consistent instructions and error identification; minimum text/non-text contrast; reflow; status announcements; and target sizes (with applicable exceptions). Aim for 44px touch targets for important controls as a **product choice**, which exceeds the 24x24px AA minimum where the spacing exception does not apply [R12]. Essential status is never only colour or icon. Audit each society-selected image and logo in context, especially where text overlays media.

**Page-specific accessibility tests:**

| Interaction | Test at minimum |
|---|---|
| Public event card | Whole card is a real descriptive link with one focus target; date/price/host announced; no nested invalid button |
| Mobile ticket sheet | Open from CTA; title announced; tab confined while modal; scroll contained; Escape and close button work; focus returns to CTA |
| Quantity/variants | Minus/plus have unique accessible names; number announces changes; disabled stock includes explanation; colour swatch has visible text |
| Role/context switcher | Announce Personal vs staff context and society; inactive/revoked society absent from authorised options |
| Event form | Label+hint associated; error summary focuses and links to field; date/time zone readable; no lost edits after re-render |
| Confirmation dialog | Title names exact order/event/actor; cancel default where safe; confirmations never happen on Escape/backdrop click |
| Order status polling | Avoid flooding screen-reader announcements; announce only meaningful transition; don't loop infinite spinner |
| Check-in | Success/denial announced; focus returns to search for next person on operator choice; offline never says success |
| Calendar | Date cell names, event summary and navigation keyboard operation; mobile agenda equivalent; no drag-only action |
| Analytics | Every chart has equivalent accessible data table and explanatory caption; no colour-only distinction |
| OpenClaw preview | Exact target, before/after, expiry and confirmation result announced; no action triggered by conversational text alone |

**Required viewports:** `320x568`, `375x667`, `390x844`, `768x1024`, `1024x768`, `1280x800`, `1440x900` and `1920x1080`, plus 200% and 400% browser zoom/reflow checks. Use real browsers and screen readers for representative tasks (NVDA+Chrome on Windows and VoiceOver+Safari/iOS where available); automated axe checks are a floor, not full certification. Also verify large text, `prefers-reduced-motion`, landscape mobile, slow 3G and offline/reconnection for check-in/order status.

## 12.2 Performance/credibility budget [D]

- Core Web Vitals goals **to measure**: LCP <=2.5 seconds, INP <=200ms, CLS <=0.1 at the 75th percentile of field sessions **where eligible**; not promises of current performance. For prototype/staging, test under throttled mid-tier mobile profiles.
- Event/card images reserve intrinsic dimensions, prefer responsive `srcset`/Next Image already configured, and only preload critical hero imagery. Do not preload entire card grid.
- No client JavaScript for static text or dates that can be server rendered safely; preserve Next.js App Router server-first composition where consistent with existing architecture.
- No colour flicker/layout shift from font loading. Server canonical values should hydrate exactly, including locale/timezone. Do not render countdown from an unconfirmed client clock before authoritative reservation data arrives.
- Choreography has purpose: motion communicates opening or completion **after** state truth; no confetti for payment successes, no pulsing “Get membership” buttons, no fake live counters.

## 12.3 Visual regression matrix

For every released layout or substantive UI change, capture at least one comparison in each relevant breakpoint/state pairing: public event with real image/no image/sold-out/member-price, ticket selection 1/free/payable/changed quote, checkout pending/confirmed/under review, organisation home new/active, event builder invalid draft/published, calendar month and mobile agenda, check-in valid/already-checked/timeout, merchandise catalog + basket, membership active/expired, staff access denied and OpenClaw preview. Include at least one high-density screen with long real-world society names and venue text to defeat “looks good with Lorem ipsum” bias.

---

# 13. Design-to-code implementation contract

## 13.1 Component architecture without a parallel app

**Before coding:** inspect real Next.js `app/` tree, existing `components/`, `lib/`, Tailwind version, UI primitives, tests, auth guards, DTOs and permission helpers. Do not add a second router, alternate styling framework, duplicated financial status mapper or global store without documented rationale. Maintain tested server-first read services, existing trusted-origin/CSRF guards and domain workflows. A frontend change does not authorise a database migration or bypass T dependencies.

**Suggested visual library boundaries [D]:**

```text
components/
  shell/         PublicShell PersonalShell OrganisationShell CheckoutShell
  brand/         BrandMark SectionRule EditorialDateRail
  discovery/     EventCard SocietyCard EventFilterBar SocietyCover
  commerce/      TicketTypeRow MoneySummary MembershipOfferCard MerchProductCard
                 PurchaseStatusPanel PickupInstructions
  attendee/      TicketFace CheckInResult
  admin/         ScopeHeader ReadinessChecklist DataTable MetricTile CalendarGrid
                 AuditTimeline ActionPreview
  form/          TextField DateTimeField MoneyField ImagePicker ErrorSummary
  feedback/      InlineNotice EmptyState ConfirmDialog LoadingFrame
styles/
  tokens.css     (or existing project token/theme entry point)
```

These are *design-level suggested groupings*, not a command to create exactly these folders. Existing working components should be adapted rather than cloned. Prefer clear co-located tests and Storybook/visual fixtures **only if supported/approved in project tooling**; tests can use existing E2E fixtures without a new framework.

## 13.2 “Every screen” implementation checklist

Each frontend PR implementing a design page should contain all of:

1. **Screen identity:** exact original screen ID(s), corresponding real route and authorised persona (not guessed URL).
2. **Composition:** chosen shell, header, H1, hierarchy, CTA and mobile behaviour matching this document.
3. **Variants:** success/loading/no-data/validation/error/denied/processing/recovery states defined in this document and [SRC-FLOW].
4. **Truth wiring:** source DTO, state/permission derivation, money and IANA zone formatting. No client-invented eligibility or status.
5. **A11y:** landmarks, focus, keyboard/VoiceOver/NVDA where appropriate, labels, contrast, non-text controls and responsive reflow.
6. **Reliability:** re-quote handling/429/503 where applicable, safe back/retry, preserve input, duplicate-submission guard that complements server idempotency.
7. **Visual review:** real image and no-image fixture, long content, zoom/mobile, empty state, screenshot comparison and component reuse.
8. **Regression:** existing route redirects, public access, staff/MFA, wallet, Stripe and checkout tests not broken.

A “page complete” review must not pass if it has a pleasant desktop success screenshot but missing guest access, mobile check-in denial, invalid member pricing or payment compensation UI.

## 13.3 Scope and rollout aligned with T tasks [I]

Design is **not** permission to jump to T34 and rebuild all routes while T10-T29 domain models remain unfinished. Map batches to the plan and deliver behind real feature readiness:

| Design slice | Source work dependencies | Completion cue |
|---|---|---|
| Foundations/shells/token primitives | T05, T07, T08 | Coherent verified personal/staff context; safe asset, profile and header |
| Public society identity | T08-T09 | Anonymous profile/search/joins with true membership distinction |
| Event/editor design | T10-T12/T15 | Readiness same as backend, draft-safe preview, public anonymous detail |
| Ticket buying/status/guest | T13-T19 | Free/paid/guest accurate; no duplicate orders; wallet/check-in verified |
| Membership pages | T20-T24 | Term/grant entitlement and member-price text backed by services |
| Merchandise pages | T25-T29 | Variant/stock/pickup/refund accurately modelled; society-only cart |
| Notifications | T02-T04/T30 | Transactional templates and status recovery consistent |
| Dashboards/analytics/calendar | T31-T34 | Data definitions, date ranges, permissions and IANA zone verified |
| OpenClaw | T35-T37 | Typed proposal, review and durable receipt, safe model adapter |
| Audit/readiness/accessibility | T38-T46 and hosted H01-H06 | Real E2E, denial, provider, accessibility, recovery and pilot evidence |

Do not mark T task complete because this document proposes a design. The prior plan's “complete/missing” matrix is a **historical 4-5 October snapshot**; current repository may differ. Fresh code inspection is required.

## 13.4 Acceptance checklist by screen ID

This covers **all 43 named screens** in [SRC-FLOW §6] exactly; nested variants are captured above rather than artificially promoted to unrelated products. An engineer may split a screen into more routes as long as these contracts hold.

| Screen | Must be visually obvious without explanation | Hard failure to prevent |
|---|---|---|
| PUB-01 Home | Explore events / societies and authentic current event cards | Fake event/follower/testimonial marketing claims |
| PUB-02 Events search | Date-first cards and functional search/filter | Unlisted/member-only event leakage |
| PUB-03 Event detail | Date, place, host and trustworthy ticket CTA | Hidden membership restriction / wrong stock |
| PUB-04 Societies | Discover society identity and its public content | Showing internal roster/finance |
| PUB-05 Society profile | One hub for events/memberships/merch, distinct Join | Free join confused for paid membership |
| PUB-06 Membership offers | One-off fixed term, clear actual benefits and price | Auto-renewal and overlapping grants implied |
| PUB-07 Merchandise catalogue | Real image, variant price, collection only | Shipping offered |
| PUB-08 Merchandise detail | Labelled variants and pickup before payment | Colour-only size/stock choice |
| AUTH-01 Sign in/register | Account type and secure entry without odd marketing | Logged-in callback lost, role escalation |
| AUTH-02 Verification | Email/resend result and real verification state | GET token consumed or raw token leaked |
| AUTH-03 Recovery/closure | Safe reset, email-change and closure consequence | Automatic login or “delete all purchases” lie |
| AUTH-04 Settings | Profile/security distinct and current state | Stale session still reading account |
| BUY-01 Ticket picker | Accurate type/price/quantity, single supported order type | Fake multi-type cart, invalid member discount |
| BUY-02 Guest verify | Guest path that verifies ownership before hold | Typed email grants order access |
| BUY-03 Ticket review | Seller, item, fees, correct final action | Client authoritative price / fake Stripe form |
| BUY-04 Ticket receipt | Pending/confirmed/compensation distinctly | Green success before backend fulfilment |
| BUY-05 Membership checkout | Verified member, exact dates, no renewal | Guest subscription/unsupported quantity |
| BUY-06 Merchandise basket | One society + bounded variants + pickup/total | Cross-society/mixed-kind cart |
| BUY-07 Merchandise status | Finance and collection stages separate | Paid implies collected / shipping tracker |
| BUY-08 Guest recovery | Purpose-scoped verified access | Public receipt lookup by ID |
| PER-01 Personal overview | Next valid admission and useful society links | Pending as valid ticket |
| PER-02 My tickets | Unique units, validity, check-in, correct history | Fake QR code or refund still admitted |
| PER-03 My memberships | Active/upcoming/expired/revoked term | Free join as entitlement |
| PER-04 Joined societies | Free affiliation with separate paid status | Leaving cancels paid grant |
| PER-05 Purchases | Three distinct order families, immutable snapshots | Duplicate ambiguous global order ID |
| ORG-01 Society overview | Permissions, tasks before charts, honest data | Finance leaks to check-in staff |
| ORG-02 Onboarding | Stable society, image, timezone, Connect optional | Fake ready-for-payments |
| ORG-03 Events index | Draft/published AND sales/visibility labels | Published represented as always selling |
| ORG-04 Event builder | Five readable chapters + live readiness | Bypass draft or auto-publish |
| ORG-05 Event workspace | One event; correct tickets/orders/check-in | Historical ticket type deletion |
| ORG-06 Check-in | Big actionable search, explicit server result | Optimistic offline admission |
| ORG-07 Calendar | Month/week/agenda, real zone, authorised drafts | Fake recurrence/sync |
| ORG-08 Orders | Tickets/membership/merch separately; true refund | Local marker styled as provider refund |
| ORG-09 Membership manage | Fixed-term products, no recurring billing | Unsupported subscription screen |
| ORG-10 Member roster | Join vs paid grants vs staff | Member gets staff authority |
| ORG-11 Merchandise manage | Variants, stock, safe images and pickup | Stock edits bypass holds |
| ORG-12 Pickup | Ready and collected confirmed independent of paid | Auto-restock/refund=returned |
| ORG-13 Analytics | Clear definitions, table parity, authorised values | Fake profit/payout or unscoped metrics |
| ORG-14 Payments | Charges/payouts/details separately | “Connected means money arrived” |
| ORG-15 Staff/handover | Named humans, invite state and safe ownership | Last owner removed or raw token exposed |
| ORG-16 Society settings | Public preview, actual brand and version edits | Private settings in public DTO |
| ORG-17 History | Time-stamped safe, attributable audits | Invented legacy history or PII leak |
| ORG-18 OpenClaw | Scoped chat, typed diff and human confirm | Unauthorised autonomous mutation |

## 13.5 Design quality red-team checklist: specifically avoiding the “AI-built” look

**Visual craft review** (human senior designer or qualified reviewer) should deliberately examine *multiple pages together*, not approve isolated screenshots:

- **Consistent unique identity:** date rail, editorial rule and purple type system appear purposefully in public pages; ticket perforation used only where functionally meaningful. If every page is a rectangular grid of four identical cards, recompose it.
- **Real-world content resilience:** test an event titled “Queensland Undergraduate Robotics and Computer Vision Welcome Picnic and Student Careers Mixer 2027”, a three-word short title, a 1000-character location description, absent event cover, multi-day date and international contact. No fragile fixed-height title truncation hiding key information.
- **A meaningful hierarchy:** tell which one action matters most on each page without reading code or hovering. Admin sees a task, event visitor sees “Get tickets”, member sees “View ticket”.
- **Brand personality with restraint:** deep purple is concentrated where expressive, not thrown behind financial tables. Chartreuse only editorial. All checkout state and account recovery pages remain sober and legible.
- **Microcopy sounds like a real product:** short, concrete, appropriately Australian terminology (society, event, pickup) and no buzzwords such as “unleash your potential”, “seamless experience”, “revolutionise your journey” scattered through the interface.
- **Icons are not decoration:** if the heading works without a tiny identical purple icon, remove it. Don't put five random illustrated mascots in every empty state.
- **Authentic imagery and actual data:** never generate fictional university logos, photos of specific societies, “97% customer satisfaction”, fake charts or testimonials to make screens seem lively.
- **No gradients as a crutch:** one carefully composed dark editorials beats a page of lavender glows and glassmorphism. No faux-glass checkout panel; contrast and performance prevail.
- **Visual consistency after interaction:** errors, offline, loading, dropdown-open, selected filters, member pricing, error-to-success and mobile states use the same design grammar, not default browser widgets injected by different agents.
- **Typography and whitespace are intentional:** 16px regular body, limited H1s, tabular finances, clear date zone, controlled line length, consistent gutters; avoid unnecessary all-caps letter-spaced tiny text.
- **Accessibility makes it feel finished:** focus states, zoom, screen-reader outcomes, text alternatives, controls that work with keyboard and visible payment/collection trust are part of visual quality, not a separate feature.
- **Brand adaptation is robust:** a society with a bright red photo, a wide white logo, dark cover, no cover and a low-res shirt photo all look intentionally integrated.

---

# 14. Consistency review and decision register

## 14.1 Cross-document decisions retained (do not silently change)

| Design requirement | Source authority | Resolution in this design |
|---|---|---|
| One society platform combining events, memberships and merchandise | PRD §§1, 6; flow §3 | Shared society profile, three distinct product categories |
| Verified email for guest purchases; signed-in verified account for membership | Plan §3.4/T16/T22; flow J01/J07 | No anonymous unverified basket checkout or paid-membership guest route |
| No combined ticket/membership/merchandise cart | Plan §3.3; flow §§0,10 | Separate checkout layouts/review, shared visual grammar only |
| One fixed-term membership purchase, non-overlapping term renewal | Plan §3.3/T22-T24 | Dates/benefits and “No automatic renewal” prominent |
| Pickup-only merchandise | Plan §3.3/T25-T28 | Product detail, basket, checkout and tracking show collection |
| Ticket types preserve history, single-type order default unless code proves more | Flow BUY-01; plan T10-T12 | Typed ticket selector, no deceptive multi-type aggregation |
| Free tickets do not require Stripe | Plan T13; flow BUY-03/04 | Free confirmation replaces paid redirect |
| 30-minute holds for paid ticket/merchandise | Plan §3.2/T27; flow §10.2 | Timer only once server returns established reservation |
| Guest purchase scoped recovery | Plan §3.4/T16; flow BUY-08 | No public purchase lookup by order reference |
| Published, sales open, inventory and charge readiness are separate | Plan T11-T15; flow §9.1 | Multiple honest status axes and exact UI copy |
| Refunds provider-verified, initial full-order only | Plan §3.3/T18/T28 | UI shows review/processing until confirmed; no arbitrary partial controls |
| Calendar staff-only with month/week/agenda, no recurrence | Plan T33; flow ORG-07 | Mobile agenda, DST-aware time zone, no public personal calendar |
| Check-in browser/name and order search, QR optional enhancement | Plan T19; flow ORG-06 | Real search/check-in, no fake QR scanner |
| Staff role lives in live permissions, not joined/paid membership | Plan T05-T06; flow §11 | Explicit staff vs Personal shell and capability nav |
| OpenClaw controlled registry, per-action confirmation and receipt | Plan T35-T37; flow ORG-18 | Action preview + exact confirm; privileged links out |
| Token handling/security/closure | Plan T02-T06 | No tokens shown, recoveries use protected POST and honest loss of session |
| Code/schema wins existing implementation facts; historical baseline may change | Plan §§1-2; flow §0 | Routes are proposals; implementation requires main inspection |

## 14.2 Potential design gaps needing product/engineering confirmation [D/V]

1. **Actual route paths:** auth/signup, personal home, event workspace tabs, pickup queue and order status paths are mapped conceptually, not verified against `app/`. Inspect current repo and preserve existing links.
2. **Multiple ticket types in one order:** user flows explicitly say *default one type per order* until schema verified; visual design must not silently make the selector a mixed-type cart.
3. **Ticket transfer/download/QR:** not required. A ticket face is a private display object, not an export or scanner code unless services explicitly support it.
4. **Filtering by campus or event category:** public search/society/date filters exist in plan, but specific campus taxonomy may not. Show only real filters; don't add unbacked form controls.
5. **Member discounts in merchandise:** competitor Rubric can have these, but Thunderstrux implementation plan specifies server-validated ticket member pricing; do **not** add automatic merchandise member price just for visual symmetry.
6. **Society marketing announcements, subscriber feeds and direct messaging:** not in current PRD-complete contract. The “Next event” and related recommendations must be based on actual published items, not invented social features.
7. **Theme customisation:** this spec offers purple design for Thunderstrux and society-provided media. Do not implement arbitrary society-selected checkout or danger-button colours without product approval.
8. **Trust, accreditation and support:** no fabricated verified-society badge, refunds guarantee, processing fee, payout ETA or compliance seal. Use only approved legal/support text.
9. **Feature completion:** T01-T04 accepted in supplied historical plan; no claim is made that later tasks are deployed today. Re-check a fresh main branch before design execution.

## 14.3 Final definition of visually complete

The website meets this design brief when a reviewer can traverse **every** screen ID in §13.4 plus critical alternate states with correct personal/society permissions, render polished pages at desktop/tablet/mobile, see consistent purple identity and authentic event imagery, understand all three commerce families, and never be misled about stock, fees, payment, membership entitlement, refunds or admission. A successful screenshot is insufficient: relevant user journeys J01-J15, source UX-001..050 and plan quality gates must be executed before calling the actual product ready for real users.

---

# 15. References and provenance

## 15.1 Primary competitor and standards sources (checked 9 October 2026)

- **[R1] Humanitix**, *The ticket buyer journey on Humanitix*: https://help.humanitix.com/en/articles/13548552-the-ticket-buyer-journey-on-humanitix . Official account-free event page/ticket/checkout description. Design observation only.
- **[R2] Humanitix**, *How to style your event page*: https://help.humanitix.com/en/articles/8951375-how-to-style-your-event-page . Official banner/logo/style/preview controls; visual lesson is society imagery before checkout.
- **[R3] Humanitix**, *Quick start guide to creating an event*: https://help.humanitix.com/en/articles/8889132-quick-start-guide-to-creating-an-event . Official draft > builder > tickets > review flow.
- **[R4] Eventbrite**, *Create an event*: https://www.eventbrite.com.au/help/en-us/articles/551351/how-to-create-an-event/ . Official organiser form/ticket/preview/publish hierarchy.
- **[R5] Eventbrite**, *Professional event listing*: https://www.eventbrite.com.au/organizer/features/event-listing/ . Event listing and buyer information hierarchy; complement with published Eventbrite checkout imagery (not pixel-copied).
- **[R6] Rubric**, *New to Rubric? Start here*: https://helpcenter.hellorubric.com/help/articles/4971905-new-to-rubric-start-here . Society product areas and member/club hub.
- **[R7] Rubric**, *Getting started with memberships*: https://helpcenter.hellorubric.com/en/help/articles/1365724-getting-started-with-memberships . Paid/free terms and benefits. Thunderstrux deliberately narrows to fixed-term/one-off.
- **[R8] Luma**, *Creating an event*: https://help.luma.com/p/creating-an-event . Event calendar ownership and public/member/private visibility.
- **[R9] Luma**, *Event themes and customisation*: https://help.luma.com/p/event-themes-and-customization . Visual theme/cover choices; Thunderstrux uses restrained bespoke design rather than copying animation.
- **[R10] Ticket Tailor**, *Ticket types and groups*: https://help.tickettailor.com/en/articles/948763-how-to-manage-ticket-types-and-groups . Capacity/price and operator clarity.
- **[R11] TryBooking**, *How to create an event*: https://learn.trybooking.com/en/articles/41877-how-to-create-an-event . Guided event creation and preview patterns.
- **[R12] W3C**, *Understanding WCAG 2.2*: https://www.w3.org/WAI/WCAG22/understanding/ and *Target Size (Minimum)*: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum . Contrast, reflow, input, focus and 24x24 CSS px target minimum/spacing exceptions.
- **[R13] Stripe**, *Payment fulfilment best practices*: https://github.com/stripe/ai/blob/main/skills/stripe-best-practices/references/payments.md . Never assume redirected payment success equals fulfilled entitlement; server verified business truth prevails.

**Visual inspiration provenance:** Official Humanitix and Eventbrite product/marketing images, Luma event examples and Rubric club hub references were reviewed for information hierarchy and brand flexibility. Examples are inspiration, **not** embedded licensed images or instructions to copy competitors' artwork. Source URLs should be rechecked at implementation because designs change.

## 15.2 Original source provenance and repository references

- **[SRC-PRD]** `THUNDERSTRUX_PRD.md`: product positioning, guest/member/organisation roles, society profiles, ticketing, checkout, memberships, merchandise, analytics, OpenClaw, permissions, UX and reliability.
- **[SRC-PLAN]** `MVP_READINESS_PLAN.md`: T01-T46 implementation requirements, phased dependencies, true states/holds/guest/email/Stripe/commerce, calendar, analytics, audit, operations and hosted H01-H06 gates. Its code snapshot is historical, not a current deployment certificate.
- **[SRC-FLOW]** `THUNDERSTRUX_UX_USER_FLOW_SPEC.md`: J01-J15 journeys, PUB/AUTH/BUY/PER/ORG inventory, accessibility, error handling, source-of-truth state maps, privacy and UX-001..050 cases. This design **keeps all 43 original screen IDs**.

---

# End of design specification

**Release instruction to coding agents:** Implement visual pages from this brief while treating PRD, technical plan and UX flow as higher authority. Before each PR inspect existing code and preserve proven payment/security/tenancy behaviour. Never fill an unsupported capability with a persuasive fake visual control. Verify every page in all critical states and viewport sizes, not just the happy-path desktop screenshot.
