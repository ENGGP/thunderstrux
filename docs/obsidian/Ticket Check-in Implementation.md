---
status: living
last-reviewed: 2026-10-30
owner: engineering
related: ["[[Event Lifecycle]]", "[[Payment Lifecycle]]", "[[Route Security Inventory]]", "[[Audit Coverage]]"]
sources: [lib/tickets/check-in.ts, lib/tickets/http.ts, components/tickets/check-in-console.tsx, components/tickets/ticket-face.tsx]
---

# Ticket Check-in Implementation

**Owns:** admitting attendees: ticket attendance state, the check-in and check-out API, ticket QR codes, and the staff check-in console with its scanner.
**Read when:** changing check-in, the attendee list or its search, or what a ticket's validity means at the door.
**Not here:** how tickets are issued, voided or put under review ([[Payment Lifecycle]]); event status ([[Event Lifecycle]]); the guard rules every route shares ([[Route Security Inventory]]).

## Code

| Concern | Where |
| --- | --- |
| List and search an event's tickets | `lib/tickets/check-in.ts`: `getOrganisationEventTickets(organisationId, eventId, { limit, cursor, direction, query })` |
| Check in, check out | `lib/tickets/check-in.ts`: `checkInOrganisationTicket(organisationId, eventId, ticketId, actorUserId)`, `checkOutOrganisationTicket(...)` |
| Error to HTTP mapping | `lib/tickets/http.ts`: `ticketRouteRules` |
| Attendee list download (owners and admins) | `GET /api/events/[eventId]/tickets/export`, `lib/export/order-exports.ts`: `exportAttendees` |
| Routes | `GET /api/events/[eventId]/tickets`, `POST /api/tickets/[ticketId]/check-in`, `POST /api/tickets/[ticketId]/check-out` |
| Console | `components/tickets/check-in-console.tsx` on the page `/dashboard/events/[eventId]/tickets` |
| Scanner | `components/tickets/check-in-console.tsx`: `qrReader`, `Camera`, `ScanPanel`; fallback decoder `@zxing/library` |
| QR codes | `components/tickets/ticket-face.tsx` (the buyer's ticket, `uqr`); the ticket email's images, `ticketQrAttachments` in `lib/email/ticket-delivery.ts` ([[Email Delivery Implementation#Ticket email]]) |
| Cursors | `lib/pagination/cursor.ts` |
| Tests | `tests/integration/ticket-check-in.test.ts`, `tests/e2e/check-in.spec.ts`, `tests/e2e/mfa-enforced.spec.ts` (door staff without an authenticator) |

## States

Attendance is one column, `Ticket.checkedInAt`: `null` is unused, a timestamp is checked in. Nothing else about a ticket changes at the door.

Whether a ticket admits is `Ticket.validity`, which payments code sets ([[Payment Lifecycle]]):

| `validity` | Check in or out | 409 `reason` | Console verdict |
| --- | --- | --- | --- |
| `active` | allowed | `already_checked_in` / `not_checked_in` on a repeat | Valid (Check in), Checked in (Undo check-in), or Already used after a refused repeat |
| `void` | refused, attendance kept | `not_valid` | Don't admit: refunded, cancelled or reversed after a dispute, with the date |
| `refund_review` | refused, attendance kept | `under_review` | Under review: "Ask an owner or finance manager before admitting" |

## Rules

- **Authority:** `tickets:check_in` on the selected dashboard context, for all three routes. Missing permission or staff authority is 403 (`organisationAccessRule`). `check_in_staff` needs no staff authenticator, as at Humanitix and Luma; every other role does ([[Authentication and Dashboard Access#Staff MFA]]).
- **Buyer emails:** `buyerEmail` is `null` unless the role has `orders:read` (owners and admins), because the same list as a CSV needs that permission, a rate limit and an audit row. Check-in staff and event managers see names; a search still matches emails on the server.
- **Tenant:** every read and write is scoped by `Ticket.event.organisationId`. `Ticket.organisationId` is stored (issuance copies `Event.organisationId`) but is never used for access. Another society's ticket is 404, the same as a missing one, so ids can't be probed.
- **Drafts:** a `check_in_staff` member sees and acts on published events only; a draft event's tickets are 404 to them. Owners, admins and event managers see drafts.
- **One event (DEBT-002):** the console sends the event it is checking as `?eventId=`; the routes refuse a request without it (400), and a ticket of the society's other events is not found (404), like another society's.
- **Guard order on check-in and check-out:** trusted origin, dashboard context, permission, rate limit `ticket_check_in_out` (300 a minute per society and action; fails open so a Redis fault never stops the door), then the session user. The list GET has no origin check or rate limit and answers `Cache-Control: no-store`.
- **Concurrency:** one conditional update inside a transaction, on `checkedInAt` (null for check-in, set for check-out) and `validity = active`. If it touches no row, the ticket is re-read: voided meanwhile gives `not_valid`, otherwise the transition conflict. Two staff admitting one ticket at once get one 200 and one 409 `already_checked_in`.
- **Audit:** each change writes `ticket.checked_in` or `ticket.checked_out` in the same transaction. "Checked in by" comes from the latest `ticket.checked_in` row, not a column. No order, Stripe or ownership state changes. Society History shows these rows under its check-ins filter ([[Audit Coverage]]).
- **Conflicts:** a 409 body names the reason in its details: `[{ path: ["ticketId"], reason }]`. The console uses the reason to re-read the ticket and explain.
- **Listing:** `limit` defaults to 25 and is capped at 100; `cursor` is opaque (`createdAt`, `id`); `direction` is `next` or `prev`. Order is `createdAt` then `id`, ascending. A bad cursor is 400. `counts` (`total`, `unused`, `checkedIn`) cover `active` tickets only, because void and under-review tickets admit no one.
- **Search:** `q` is cut to 100 characters and used from 2. Either the whole query appears in the ticket or order id, or every word matches a buyer name or email: the order's purchase snapshot, the member's account, or the guest's email. A search includes void and under-review tickets, so staff can say why someone can't come in. Without a search the list shows only `active` tickets.
- **QR codes:** a ticket's code holds its id and nothing else (`uqr`, error correction M, a four-module quiet zone, dark on white so it scans in dark mode). It needs no secret: the check-in route is staff-only and scoped to its event, and a copy admits once, like the ticket (the next scan reads Already used). The ticket face and the email show it only while the ticket is `active`.
- **Without a code:** attendees are also found by name, email or reference. Guests give a name at checkout and members at signup, so name search finds both (DEF-055). The reference is `ticketReference` (`lib/format.ts`), the same six characters on the ticket email, the wallet, the order pages and the console (DEF-059).

## Console behaviour

- Phone first. It shows "{n} of {total} checked in", then **Search** (the default) or **Scan QR codes**. Search is a "Find a ticket" field that searches as you type, from 2 characters. A late answer to an older search never replaces a newer one. A search asks for 25 matches and says "Showing the first 25 matches. Keep typing to narrow it down." when there are more; the list on screen stays until the first answer.
- One card per ticket shows: the buyer, the purchased ticket type name, the short reference with "n of m", "guest" on guest orders, and the email for roles that may read it. Then comes the verdict and its button. Buttons name the attendee in screen-reader text ("Check in Alex Lee").
- After any server answer the card re-reads its ticket (`?q={ticketId}`) and the page refreshes the counts.
- Every state has one detail line ("Not checked in yet." while valid), so admitting someone never pushes the button down. A check-in this card made reads "Checked in just now." and its button slot shows a still "Checked in" for 2 seconds, so a second tap can't land on Undo; then Undo check-in is a small link at the slot's end. A 409 `already_checked_in` reads "Already used" (warning): "Checked in at {time} by {name}. Don't admit twice." A ticket already in when the list loaded reads "Checked in at {time} by {name}."
- 401, 403 and 429 save nothing and say nothing about the ticket, so the card keeps its state and shows why on the card (sign in again, no check-in access, wait) as an alert; `fetchWithCsrf` returns these rather than throwing.
- With no answer in 10 seconds the card shows "Status unknown" and Reload ticket. It never claims a check-in it can't confirm, and a reload of one that did save shows it as checked in.

## Scanning

- **Scan QR codes** opens the rear camera and reads a frame every 150 ms with the browser's `BarcodeDetector` where it reads QR codes (Chrome on Android, macOS). Elsewhere, iOS included, it loads ZXing's QR reader (`@zxing/library`'s QR modules only, about 26 KB gzipped) and reads a frame scaled to 640 pixels across. The camera needs `Permissions-Policy: camera=(self)` ([[Route Security Inventory#Headers and caching]]).
- A read checks the ticket in at once, as door apps do, then shows its card from a fresh read: Checked in just now, Already used (with time and who), Don't admit (void, with why), or Under review. A 404 reads "Not for this event": another event's or society's ticket, or a code that isn't a ticket. Text that isn't an id shape gets the same answer without a request. 401, 403 and 429 read "Not saved" with the reason; no answer reads Status unknown with Reload ticket.
- One code at a time, the newest result on screen. A code held in view counts once and again only after 3 seconds out of view, so the camera re-reading a ticket never turns "Checked in just now" into "Already used", while a copy shown later does.
- A blocked or missing camera, or a scanner that didn't load, says so and points to search. Leaving Scan stops the camera.

## Traps

- Don't authorise from `Ticket.organisationId` or a client-sent organisation; use the event's owner.
- Don't change `validity` here. Refunds, disputes and cancellations own it, and they keep the attendance record as it was.
- A new 409 reason needs a rule in `ticketRouteRules` and a verdict in the console, or staff see a generic error at the door.
- Keep the QR payload the bare ticket id: the scanner posts what it reads straight to `POST /api/tickets/[ticketId]/check-in`. Codes already on issued tickets and emails can't change.
- Turning the camera off in `Permissions-Policy` again silently breaks scanning: the console only shows "No camera is available here".

## Related

[[Event Lifecycle]] · [[Payment Lifecycle]] · [[Route Security Inventory]] · [[Audit Coverage]] · [[API Reference]]
