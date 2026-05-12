# Handover 2026-05-03 - Ticket Operations and Email Delivery

Read [[Current Handover]] first. This handover records the current organiser operations work after the Docker/runtime handover in [[Handover 2026-05-03 Docker Runtime Hardening]].

## Session Focus

Implemented and documented the organiser operational layer around orders, issued tickets, check-in, and ticket delivery email.

Completed areas:

- Organiser order detail page and safe order APIs.
- Manual refund bookkeeping flag.
- Event ticket list, manual attendee check-in, and check-out.
- Ticket delivery email after successful paid webhook fulfilment.
- Manual ticket email resend from order detail.
- Integration tests for order access, resend behavior, webhook email delivery, and ticket check-in.

## Database State

Latest relevant migrations:

- `20260503020000_manual_order_refund_flag`
- `20260503030000_ticket_check_in_state`
- `20260503040000_ticket_email_delivery_tracking`

New operational fields:

- `Order.isManuallyRefunded`
- `Order.ticketEmailSentAt`
- `Order.ticketEmailLastError`
- `Order.ticketEmailResentAt`
- `Ticket.checkedInAt`

Rules:

- `Ticket.checkedInAt = null` means unused.
- `Ticket.checkedInAt != null` means checked in.
- Check-out clears `Ticket.checkedInAt` back to `null`.
- Manual refund is local bookkeeping only and does not call Stripe.
- Ticket email tracking is delivery state only and is not payment truth.

## Routes And APIs

Organiser pages:

- `/dashboard/orders`
- `/dashboard/orders/[orderId]`
- `/dashboard/events/[eventId]/tickets`

APIs:

- `GET /api/orders`
- `GET /api/orders/[orderId]`
- `PATCH /api/orders/[orderId]/refund-manual`
- `POST /api/orders/[orderId]/resend`
- `GET /api/events/[eventId]/tickets`
- `POST /api/tickets/[ticketId]/check-in`

All organiser operations are scoped from `session.user` through `Organisation.accountUserId`. Do not trust frontend organisation ids for ownership.

## Email Delivery

Service file:

```text
lib/email/ticket-delivery.ts
```

Runtime env:

```text
RESEND_API_KEY=
EMAIL_FROM=
```

Automatic email behavior:

- Runs only after successful paid checkout reconciliation and ticket issuance.
- Sets `ticketEmailSentAt` on success.
- Sets `ticketEmailLastError` on failure.
- Skips duplicate automatic sends when `ticketEmailSentAt` is already set.
- Never rolls back payment, reservation confirmation, inventory decrement, or ticket creation.

Manual resend behavior:

- Paid orders only.
- Organisation-owned orders only.
- Sends even if the automatic email was already sent.
- Sets `ticketEmailResentAt` on success.
- Sets `ticketEmailLastError` on failure.

## Verification

Latest verification after email delivery work:

```bash
pnpm exec tsc --noEmit
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app pnpm test:integration
```

Results:

- TypeScript check passed.
- Integration tests passed with 10 files and 46 tests.

Expected integration stderr still appears in tests that intentionally exercise Stripe/reconciliation failure paths.

## Known Limits

- No QR scanning yet.
- No email attachments.
- No queue or retry worker.
- No notification preferences.
- No check-in actor/audit trail.
- Manual refunds do not invalidate tickets in this MVP.

## Preserve

- Never mark orders paid outside Stripe webhook reconciliation.
- Never change Stripe payment state from Thunderstrux manual actions.
- Never expose pending orders in normal organiser or member UI.
- Never overwrite an existing `Ticket.checkedInAt` during check-in.
- Never check out a ticket that is already unused.
- Keep ticket delivery email outside the fulfilment transaction so email failure cannot break payment fulfilment.
