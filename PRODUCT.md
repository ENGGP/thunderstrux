# Product

<!-- impeccable:product-schema 1 -->

> **Summary only.** This file condenses [the PRD](docs/THUNDERSTRUX_PRD.md) for design tools. The PRD owns product outcomes and wins on any conflict; journeys and copy belong to [the UX specification](docs/THUNDERSTRUX_UX_USER_FLOW_SPEC.md), presentation to [the visual design specification](docs/THUNDERSTRUX_COMPLETE_VISUAL_DESIGN_SPEC.md) and [UI Architecture Rules](docs/obsidian/UI%20Architecture%20Rules.md). Change the PRD first, then this summary.

## Platform

web

## Users

- **Society organisers:** student executives and volunteers (owner, events, finance, membership secretary, merchandise and door staff) who run a society with no training and hand it to a new committee every year. They create and publish events, sell tickets, memberships and merchandise, check people in at the door, refund, and read their numbers.
- **Members:** students with a personal account who find events and societies, buy tickets and fixed-term memberships, order merchandise for pickup, and keep their tickets and purchases in one place.
- **Guests:** visitors arriving from a shared Instagram or Discord link who want event details and a ticket without creating an account; they verify their email before checkout.

## Product Purpose

Thunderstrux is a society-first operating platform: one place for a student society's public presence, events, ticketing, memberships, merchandise, payments, staff and analytics, replacing scattered ticketing sites, payment links and spreadsheets. Success means organisers run real society operations without training, buyers always know what they own and whether they paid, and the society's knowledge survives committee handover.

## Positioning

Not a generic event ticketing clone. Eventbrite, Humanitix and Luma sell tickets for events; Thunderstrux models the society itself: committee turnover and owner handover, scoped staff roles, a public society hub that holds events, memberships and merchandise together, and fees set below Humanitix (3.75% plus $0.89 a ticket, including card processing).

## Operating Context

- Launches with societies at one Brisbane university; times default to the society's IANA zone (`Australia/Brisbane`) and money is AUD.
- Organisers work on laptops between classes and on phones at the door; buyers mostly arrive on phones from social links.
- Payments run through Stripe Connect; each society connects its own account. Stripe is the payment truth: an order is paid only when the signed webhook says so, never from a success page.
- Each society's data is private to its live staff; organisation and member experiences are separate.

## Capabilities and Constraints

- Built and locally qualified: accounts and recovery, society profiles and discovery, events with multiple ticket types, free and paid tickets, guest checkout, check-in, refunds and disputes, event cancellation, fixed-term memberships (no auto-renewal), pickup-only merchandise, calendar, analytics, staff roles with MFA, and committee handover.
- Not hosted for real users yet; hosting, live Stripe webhooks, object storage and legal terms are the open gates.
- **Deferred:** the OpenClaw AI assistant (PRD 6.12). Design nothing for it.
- Terminology: "Join society" is free association; a membership is a paid or free fixed-term product; a ticket is an admission entitlement; a merchandise order is a pickup obligation. Keep them distinct.

## Brand Commitments

- Name: Thunderstrux. Australian English, plain and specific copy; the button vocabulary in UX specification 5.4 is binding (for example "Get tickets", "Pay A$XX.XX", "Join society", never "Payment successful" before the webhook).
- Thunderstrux owns checkout, payment and trust chrome; a society's own branding never replaces purchase, status or security cues.

## Evidence on Hand

None yet. There are no live societies, real photos, testimonials, attendance figures or press; the local database holds seed and QA data only. Design work must not invent societies, quotes, metrics or growth; use empty states and branded placeholders instead.

## Product Principles

1. Society-first: design for student volunteers and committee turnover, not professional event managers.
2. Trust over flourish wherever money, tickets, attendance or permissions are involved: honest states, no premature success.
3. Members and organisations are clearly separate experiences, and every management action respects live staff authority.
4. Simple enough to use without training; clear next steps over dense configuration.
5. Records stay true: past orders keep the prices and names that applied when they were made.

## Accessibility & Inclusion

WCAG 2.2 AA: visible labels and focus, 4.5:1 text contrast, 44px touch targets where practicable, no sideways scroll at 320px or 200% zoom, and `prefers-reduced-motion` honoured. Status is never conveyed by colour alone.
