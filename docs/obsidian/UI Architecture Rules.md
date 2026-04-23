# UI Architecture Rules

## Dashboard Navigation Rule

Organisation dashboard navigation must live in:

```text
components/layout/dashboard-shell.tsx
```

Current shared nav items:

- `Dashboard`
- `Events`
- `Settings`

Do not duplicate these links in page files.

## Layout Responsibilities

Root layout:

```text
app/layout.tsx
```

Responsibilities:

- Load the initial auth session.
- Render `AuthSessionProvider`.
- Render the global `Navbar`.
- Render page content.

Organisation dashboard layout:

```text
app/(dashboard)/dashboard/[orgSlug]/layout.tsx
```

Responsibilities:

- Resolve `orgSlug`.
- Require organisation membership.
- Render `DashboardShell`.

Dashboard shell:

```text
components/layout/dashboard-shell.tsx
```

Responsibilities:

- Render shared organisation navigation.
- Render shared dashboard header.
- Render children content.

## Page Responsibilities

Pages should render only route-specific content and actions.

Examples:

- `/dashboard` renders organisation selection and onboarding.
- `/dashboard/[orgSlug]` renders overview content and `View events`.
- `/dashboard/[orgSlug]/events` renders the event list.
- `/dashboard/[orgSlug]/settings` renders Stripe Connect settings.

## Current Button Rules

`/dashboard`:

- Shows `New organisation`.
- Shows organisation cards.
- Organisation cards show `Open dashboard`.
- Organisation cards do not show `Settings`.

`/dashboard/[orgSlug]`:

- Shared nav shows `Dashboard`, `Events`, `Settings`.
- Page content shows `View events`.
- Page content must not show `Open settings`.

## Debugging UI Duplication

If an old button appears in the browser but not in source:

1. Search the whole codebase, including `.next`, for the exact text.
2. Compare source and compiled output.
3. Clear `.next`.
4. Restart the Docker app container.

See [[Troubleshooting]] for the full stale-build playbook.

