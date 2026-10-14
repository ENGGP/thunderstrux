---
status: living
last-reviewed: 2026-10-14
owner: engineering
related: ["[[Frontend and Backend Flow]]", "[[Authentication and Dashboard Access]]"]
sources: [app/globals.css, app/layout.tsx, components/layout/navbar.tsx, components/layout/dashboard-shell.tsx, components/layout/personal-shell.tsx, components/ui/button.tsx]
---

# UI Architecture Rules

[Visual Design](../THUNDERSTRUX_COMPLETE_VISUAL_DESIGN_SPEC.md) owns the target presentation. This note records what the code does today and the rules new UI must follow. Every existing screen uses the token source, fonts, primitives and shells described here. Screens for features that are not built yet do not exist.

## Tokens And Fonts

`app/globals.css` is the only token source.

- `:root` defines the `--ts-*` custom properties: ink, brand, paper and surface colours, borders, focus, and five status roles. Success (jade), warning (ochre), danger (crimson), info (brand lilac) and neutral each have a text colour, a `-bg` wash, a `-border` hairline and an `-icon` mark; every text colour is at least 6:1 and every icon colour at least 3:1 on its own wash.
- `@theme inline` exposes them as semantic Tailwind utilities: `bg-paper`, `bg-surface`, `text-ink`, `text-ink-soft`, `bg-brand`, `border-line`, `border-line-strong`, `text-danger`, `bg-warning-bg`, `rounded-control` (9px), `rounded-card` (14px), `shadow-float`, and the widths `max-w-auth`, `max-w-read`, `max-w-checkout`, `max-w-personal`, `max-w-page`, `max-w-admin`.
- New UI uses these names. Do not add raw palette classes such as `bg-neutral-900` or `text-purple-600`, and do not add hex colours in components.
- Bare `border` utilities draw the hairline token; Tailwind's `currentColor` default is overridden in the base layer.
- The keyboard focus ring is a 2px `--ts-focus` outline defined outside any layer, so `outline-none` cannot remove it.
- `app/layout.tsx` loads DM Sans (UI) and Space Grotesk (`h1`, `h2`, `font-display`) through next/font. They are downloaded at build time and served by the app.
- There is no dark mode and no icon library: `components/ui/icon.tsx` holds the few outline icons the UI uses, always decorative beside text. `prefers-reduced-motion` shortens every transition.

## Primitives

`components/ui/` holds the shared primitives. Extend them rather than writing class strings in pages.

- `button.tsx`: `Button` and `buttonClasses()` for links that look like buttons. Variants `primary`, `secondary`, `tertiary`, `danger`; sizes `sm` (36px), `md` (44px), `lg` (48px).
- `input.tsx`: `TextInput`, `TextArea`, `Select`. The `<label>` contains only the label text. Hint and error text sit outside it and are tied to the control with `aria-describedby`; an error also sets `aria-invalid`.
- `card.tsx`: bordered surface with an optional `className`.
- `notice.tsx`: inline message in `info`, `success`, `warning` or `danger`: a soft wash, a hairline border, an icon and a toned title, with body text in ink. `onDismiss` (client callers only) adds a close button. Pass `role="alert"` or `role="status"` only when it reports the result of an action; a page should not gain a permanent live region.
- `status-badge.tsx`: the one mapping from a server status to its words and colour: a pill with a dot and the word. Draft, expired, revoked and unused are neutral; joined uses the brand accent. Add a status there, not in a page.
- `confirm-dialog.tsx`: native `<dialog>` confirmation that names the action and its consequences. Its body is mounted only while open, and Escape cancels. Use it instead of `window.confirm`.

Shared content components: `components/events/event-card.tsx` (date rail, host link, one whole-card event link, dates in the society's zone) and `components/organisations/society-card.tsx`. Neither shows an image, price or count that the data model does not hold.

## Global Header And Footer

`components/layout/navbar.tsx` owns the header, rendered once by `app/layout.tsx`.

- Fixed, 60px high below `md` and 72px from `md`, including its bottom border. `app/layout.tsx` offsets content by the same amounts and `DashboardShell` starts its sidebar at 72px.
- It reads only the session. It never shows a society, a role or an email address.
- Desktop: `Thunderstrux` (to `/`), `Explore events` (`/`), `Explore societies` (`/societies`); signed in, `My tickets` for member accounts, `Dashboard`, `Account` (`/account/settings`) and a `Sign out` button; signed out, `Sign in` and `Create a society` (`/signup`).
- Below `md`: a native `Menu` disclosure holds the links. `Sign out` (or `Sign in`) stays visible outside it.
- The header owns the link names `Explore events` and `Explore societies`. Other links to the same places use different words (`Events`, `Find a society`, `Browse societies`) so every link name is unique on a page.

`components/layout/site-footer.tsx` is rendered by `app/(public)/layout.tsx` for the society and event pages, and by the home page itself. It lists only destinations that exist; support, terms and privacy links wait for real pages. The public layout does nothing else: no authentication, context or data loading.

### Email verification reminder

`app/layout.tsx` renders `components/layout/verify-email-banner.tsx` under the header for a signed-in user whose email is not verified. Its close button sets the `thunderstrux-verify-dismissed` cookie to the user id for seven days, and the layout skips the banner while that cookie matches. Dismissing never changes verification: `requireVerifiedUser` and `lockVerifiedAccount` still refuse purchases, joins, society creation and invitation acceptance, and those screens prompt where the action happens. The banner is a labelled region, not a live region, and links to `/verify-email`.

## Shells Are Composed By Pages

Each page renders its own shell after its guards have passed. Shells are not placed in route-group layouts: a layout would not re-render when authority changes, and page output is rendered directly by integration tests. No root or dashboard `loading.tsx` exists, because it would stream a 200 where a page currently answers with a redirect or a concealed 404.

### Auth shell

`components/layout/auth-shell.tsx` is the narrow column for sign-in, signup, verification, recovery, email-change confirmation, staff invitation acceptance, staff MFA and the payment return pages. It adds a title, an optional description and nothing else: no navigation and no lists.

### Personal shell

`components/layout/personal-shell.tsx` wraps `/dashboard` in personal context, `/dashboard/organisations`, `/tickets` and `/account/settings`.

- Navigation: `Overview`, `My tickets`, `Societies`, `Account`. Organisation accounts see `Overview` and `Account` only.
- It shows the context switcher only when the page passes `contexts`; `/dashboard` does. Exactly one switcher is rendered.
- It must never show society management controls.

### Organisation shell

`components/layout/dashboard-shell.tsx` (`DashboardShell`) owns organisation navigation. Do not duplicate these links in page files.

| Group | Item | Route | Capability |
| --- | --- | --- | --- |
| (none) | Overview | `/dashboard` | none |
| (none) | Events | `/dashboard/events` | `events:read` |
| (none) | Orders | `/dashboard/orders` | `orders:read` |
| Settings | Society profile | `/dashboard/settings/profile` | `organisation:settings` |
| Settings | Staff | `/dashboard/settings/staff` | `staff:manage` |
| Settings | Payments | `/dashboard/settings` | `stripe:manage` |
| Settings | Email delivery | `/dashboard/notifications` | `orders:email_resend` |

The staff authenticator (`/mfa`) is not organisation navigation: it is reached from Account settings, Password and security, and automatically when a page requires verification.

- Filtering is presentation. Every page and API independently enforces the same capability.
- The longest matching route sets `aria-current="page"`.
- From `lg` the navigation is a 244px deep-plum column whose contents stick below the fixed header, so the verify-email banner pushes it down instead of sitting under it. Below `lg` the same column holds `Current organisation`, the society name and the `Organisation menu` disclosure.
- Each page renders its own title as the only `h1` through `components/layout/page-header.tsx` (or an `h1` of its own); section headings are `h2`. The society name is plain text in the sidebar.
- The workspace switcher is labelled `Workspace`.
- A navigation item is added only when its destination exists. Calendar, Members, Memberships, Merchandise, Analytics, History and OpenClaw are absent until their tasks deliver them.

### Context switcher

`components/layout/context-selector.tsx` receives its choices from the server with the page. `requireManagementPage` returns them after both guards pass, and `/dashboard` passes the context it already loads; the browser does not fetch them. Selecting a context records a signed, login-bound preference through `POST /api/me/context` and carries no authority.

## Account-Specific Dashboards

`/dashboard` is role-aware.

Member accounts in personal mode, including named staff on a fresh login:

- See profile completion, their nearest upcoming paid tickets and joined societies inside the personal shell. The overview has no metric tiles.
- Can navigate to `/dashboard/organisations` to search and join organisations.
- Can browse public events and view `/tickets`.
- Must not see organisation management navigation.

Explicitly selected live staff context and permitted legacy organisation context:

- See the permitted organisation dashboard at `/dashboard` inside `DashboardShell`.
- Use slugless management routes: `/dashboard/events`, `/dashboard/orders`, `/dashboard/settings`.

Legacy `/dashboard/[orgSlug]/*` routes are compatibility redirects only.

## Page Responsibilities

`/dashboard`

- Member: profile completion, upcoming tickets, joined societies with a Find societies entry point.
- Organisation: setup tasks the caller may act on first (finish profile, finish payment setup, create an event), then upcoming events and, with `orders:read`, month-to-date revenue and recent orders. The revenue figure is labelled with its period; there is no chart.

`/dashboard/events`, `/dashboard/events/new`, `/dashboard/events/[eventId]/edit`

- Render the event list, creation and editing content. Each form route renders one title from the form: `New event` or `Edit event`. Deleting an event asks through `ConfirmDialog`.

`/dashboard/orders`

- Renders canonical tenant-scoped order review for callers with live finance capability, regardless of account role.
- Normal filters hide internal pending orders. `Show system orders` may expose pending orders for debugging, but pending must not be presented as a normal product status.

`/dashboard/settings` (Payments)

- Renders Stripe Connect settings. State-specific Connect controls are allowed here because they are settings content, not dashboard navigation.

`/dashboard/organisations`

- Renders caller-only joined societies and bounded paged search. Explicit verified Join changes free affiliation only; Leave synchronises both views after refresh and never revokes staff or paid purchases.

`/societies` and `/societies/[orgSlug]` render anonymous discovery and public profile content. `/organisations` and `/organisations/[orgSlug]` redirect to them permanently. Profile join controls are personalized and dynamic; sign-in/verification never automatically joins. `/dashboard/settings/profile` (Settings) is the live-settings/MFA-protected resumable editor: four steps, a timezone list computed on the server, and a Finish step whose checklist shows only facts the caller may see (profile complete, payments ready, team size). On a version conflict it keeps the edits and offers `Save my version` or a confirmed reload.

`/dashboard/settings/staff` (Staff) confirms a role change or revocation through `ConfirmDialog`, lists pending invitations, and shows the latest accepted, revoked and expired invitations in a separate history table. Revoking an invitation is immediate.

`/dashboard/create` uses the auth shell and asks only for the society name. [[Society Profiles and Assets]] owns their full contracts.

`/success` and `/cancel` are the payment return pages. `/success` says `Checking payment status` and links to My tickets; it never states that a payment succeeded, because only the signed webhook establishes that.

`app/not-found.tsx` and `app/error.tsx` are the shared missing-page and failure pages. The missing page is also what a foreign tenant resource renders and must not hint at whether the resource exists.

## Stripe Settings UI Rules

The Stripe Connect settings card should render from backend lifecycle state:

- `NOT_CONNECTED`: connect button only.
- `PLATFORM_NOT_READY`: platform settings link, retry button, and local disconnect button.
- `CONNECTED_INCOMPLETE`: continue onboarding.
- `RESTRICTED`: fix account and show requirements if Stripe provides them.
- `READY`: show readiness and cached flags.
- `ERROR`: show clear error and recovery actions.

Always show the readiness rows when status exists:

- Lifecycle state
- Stripe account
- Charges enabled
- Payouts enabled
- Details submitted

Do not call an account "ready" just because `stripeAccountId` exists.

`Disconnect Stripe account` is local-only. It may appear for connected states and `PLATFORM_NOT_READY`. It clears local organisation Stripe fields and does not delete the Stripe account in Stripe.

## Known UI Inconsistencies

- The event builder, order, check-in and payment screens keep their pre-specification structure under the new presentation; their target layouts belong to T11-T19.
- `components/auth/staff-mfa-form.tsx` and `components/settings/staff-handover.tsx` style their own controls with token classes instead of the `Button` and `Select` primitives.

## Notification Recovery

The shared DashboardShell owns the Email delivery navigation link. `/dashboard/notifications` requires live email-resend authority and renders a bounded failed-business-job list, review-reason forms, accessible status/error feedback and pagination. Account-security jobs are private and absent.
