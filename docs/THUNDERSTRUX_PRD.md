# Thunderstrux Product Requirements Document

## 1. Product Summary

Thunderstrux is a student society and community organisation platform designed to centralise event hosting, ticketing, organisation management, member engagement, payments, and operational workflows into one product.

The platform is intended for university societies, clubs, student associations, and similar community organisations that need a simpler, more integrated way to manage their activities. It combines the core value of event platforms such as Humanitix and Eventbrite with society-specific tools such as membership management, organisation dashboards, merchandise, analytics, and AI-assisted administration.

Thunderstrux should feel like an operating system for student societies: one place where organisers can manage events, sell tickets, understand engagement, handle payments, communicate with members, and reduce repetitive administrative work.

## 2. Product Purpose

The purpose of Thunderstrux is to help student societies and community organisations run more professionally with less administrative burden.

Many student organisations currently rely on scattered tools: one platform for ticketing, another for payments, another for communication, another for spreadsheets, and another for analytics. This creates fragmentation, duplicated work, lost information, poor handover between executive teams, and inconsistent member experiences.

Thunderstrux solves this by providing a single product where organisations can manage their public presence, internal workflows, events, tickets, members, payments, merchandise, and automation.

The product should prioritise:

- reducing manual administration for organisers
- making events easier to create, publish, sell, and manage
- improving the member experience when discovering and attending events
- giving societies better visibility into orders, attendance, revenue, and engagement
- supporting clean handover between society teams over time
- creating a scalable foundation for AI-assisted organisation operations

## 3. Target Users

### 3.1 Organisation Users

Organisation users represent societies, clubs, student associations, or community groups. They need tools to manage their organisation, events, payments, members, and operational content.

Organisation users should be able to:

- create and manage their organisation profile
- create, edit, publish, and unpublish events
- configure ticket types and ticket quantities
- connect payment accounts
- review orders and ticket sales
- check in attendees
- view event and organisation analytics
- manage organisation settings
- use AI-assisted tools to reduce administrative workload

### 3.2 Member Users

Member users are individuals who interact with organisations through Thunderstrux. They may browse events, buy tickets, join organisations, purchase memberships, view their tickets, and engage with society content.

Member users should be able to:

- create a member account
- discover organisations and events
- view event details
- purchase tickets
- access their tickets
- join or follow organisations
- purchase memberships where applicable
- view relevant member content
- interact with organisation services through clear, simple flows

### 3.3 Guest Users

Guest users are unauthenticated visitors. They should be able to access public-facing information and purchase tickets where guest checkout is supported.

Guest users should be able to:

- browse public events
- view public event details
- purchase tickets when allowed
- understand who is hosting an event
- access a clean and trustworthy checkout flow

## 4. Product Positioning

Thunderstrux should be positioned as a society-first platform, not a generic event ticketing clone.

Generic platforms often focus mainly on event discovery, ticket sales, and payment processing. Thunderstrux should go further by understanding the specific needs of student organisations: committee turnover, member management, campus events, sponsorship, merchandise, recurring activities, society administration, merchandise, analytics, and AI-supported workflows.

The product should aim to be:

- simpler than enterprise event management tools
- more society-specific than Eventbrite-style platforms
- more integrated than a collection of spreadsheets and payment links
- more transparent and affordable for student organisations
- flexible enough to support different society sizes and operating styles

## 5. Core Product Principles

### 5.1 Society-First Design

Every feature should be designed around the real workflows of societies and community organisations. The product should not assume professional event managers or enterprise administrators. It should support student executives, volunteers, committee members, and casual organisers.

### 5.2 Clear Separation Between Member and Organisation Accounts

Thunderstrux should clearly distinguish between members and organisations.

A member account represents an individual person. An organisation account represents a society or group. This distinction should influence onboarding, dashboards, permissions, navigation, and available actions.

### 5.3 Simple, Trustworthy Event Flows

Creating, publishing, selling, and managing an event should be straightforward. Organisers should understand what state an event is in, whether tickets are available, whether payments are configured, and whether attendees can purchase tickets.

Public users should never be confused about whether an event is available, sold out, unpublished, or unavailable for payment.

### 5.4 Payment Safety and Order Integrity

Ticket sales and payment flows must be reliable. Thunderstrux should avoid duplicate ticket issuance, incorrect inventory changes, inconsistent order states, and unclear payment outcomes.

Payment-related logic should prioritise correctness, auditability, and user trust.

### 5.5 Handover-Friendly Operations

Student societies often change leadership every year. Thunderstrux should preserve organisational knowledge and reduce the chaos of handover. Important information should live inside the platform rather than being scattered across personal accounts, private chats, random documents, or disconnected spreadsheets.

### 5.6 Extensible Architecture

The product should be designed so future feature areas can be added without rewriting core flows. Events, memberships, merchandise, analytics, AI actions, and organisation settings should fit into a coherent product model.

### 5.7 AI as an Assistant, Not a Replacement

AI features should help organisers perform actions faster, understand information, and navigate the product. AI should support workflows such as finding information, summarising data, suggesting actions, and executing approved administrative tasks.

AI should not hide critical business logic or make irreversible changes without clear user control.

## 6. Core Feature Areas

## 6.1 Authentication and Account Types

Thunderstrux should support user accounts with clear role-based experiences.

### Requirements

- Users should be able to sign up and sign in securely.
- Users should have an account type that determines their dashboard experience.
- Member accounts should represent individuals.
- Organisation accounts should represent organisations.
- Organisation accounts should manage exactly one primary organisation unless the product explicitly supports multi-organisation management.
- Member onboarding should collect relevant personal profile information.
- Organisation onboarding should collect relevant organisation information.
- Navigation should be role-aware.

### Product Expectations

A member should not see organisation management tools unless they have the correct authority. An organisation user should have direct access to organisation operations such as events, orders, payments, settings, and analytics.

## 6.2 Organisation Profiles

Organisations should have public and private information.

### Requirements

- Organisations should have a name, description, branding, and public profile.
- Organisations should be able to display public events.
- Organisations should be able to manage private administrative settings.
- Organisation pages should help members understand who the organisation is and what it offers.

### Product Expectations

Organisation profiles should act as a home base for society identity, discovery, events, memberships, and future engagement tools.

## 6.3 Event Management

Event management is a central feature of Thunderstrux.

### Requirements

Organisers should be able to:

- create events
- edit event details
- save events as drafts
- publish events when ready
- unpublish events where appropriate
- configure event date, time, location, description, capacity, and visibility
- configure one or more ticket types
- define ticket prices and quantities
- view public event pages
- manage attendee-facing event information

### Event States

Events should have clear states such as:

- draft
- published
- unavailable or restricted where applicable

Draft events should not be publicly purchasable. Published events should be visible and purchasable only when all required conditions are satisfied.

### Product Expectations

The event creation flow should prevent broken public pages and invalid checkout states. Organisers should receive clear feedback when an event cannot be published or sold due to missing information, missing tickets, payment configuration issues, or other blockers.

## 6.4 Public Event Discovery

Thunderstrux should allow users to discover events through public-facing pages.

### Requirements

- Public users should be able to browse available events.
- Event cards should present key information clearly.
- Event detail pages should show complete public information.
- Public event pages should include ticket purchase options when available.
- Unavailable, draft, or invalid events should not appear as purchasable public events.

### Product Expectations

The discovery experience should feel clean, trustworthy, and fast. It should help members and guests quickly understand what an event is, who hosts it, when it happens, where it happens, and how to attend.

## 6.5 Ticketing

Ticketing should support simple and reliable event attendance flows.

### Requirements

- Events should support multiple ticket types.
- Ticket types should have a name, price, and available quantity.
- Ticket purchases should create orders and issued tickets.
- Ticket inventory should be handled safely.
- Organisers should be able to view ticket sales.
- Organisers should be able to check in attendees.
- Attendees should be able to access their tickets.

### Ticket Type Rules

Ticket type changes should preserve historical order accuracy. If a ticket price or name changes later, past orders should still reflect the details that applied at the time of purchase.

### Product Expectations

Ticketing must favour consistency. Users should not be charged without receiving tickets, and organisers should not see misleading inventory or order information.

## 6.6 Orders and Checkout

Thunderstrux should provide a safe checkout flow for ticket purchases.

### Requirements

- Users should be able to purchase tickets through a clear checkout process.
- Orders should have explicit statuses.
- Payment completion should result in ticket issuance.
- Failed, expired, or incomplete payments should not issue tickets.
- The system should avoid duplicate fulfilment.
- Organisers should be able to review orders.
- Order records should preserve important purchase details.

### Order Integrity Expectations

Order and payment handling should be idempotent. Repeated webhook deliveries, retries, or refreshes should not create duplicate tickets or incorrectly reduce inventory multiple times.

## 6.7 Payments and Connected Accounts

Thunderstrux should support organisation-level payment setup so societies can receive revenue from ticket sales and other purchases.

### Requirements

- Organisations should be able to connect a payment account.
- Payment readiness should be clearly displayed.
- Public checkout should only be available when the organisation can receive payments.
- Payment failures or setup issues should be communicated clearly.
- Platform fees, if applied, should be transparent and consistently calculated.

### Product Expectations

Payment setup should not feel mysterious. Organisers should know whether they are ready to sell tickets, what action is required, and whether money can be received successfully.

## 6.8 Attendee Check-In

Thunderstrux should support event-day operations through attendee check-in.

### Requirements

- Organisers should be able to view issued tickets for an event.
- Organisers should be able to mark tickets as checked in.
- Check-in status should be visible.
- Check-in records should include useful audit information where appropriate.

### Product Expectations

Check-in should be fast and reliable. It should support real event conditions where organisers need to process attendees quickly.

## 6.9 Memberships

Memberships should allow organisations to manage ongoing relationships with members beyond single events.

### Requirements

- Organisations should be able to offer memberships where applicable.
- Members should be able to join organisations or purchase memberships.
- Membership status should be visible to both members and organisations.
- Memberships should support society-specific access, pricing, or engagement features where needed.

### Product Expectations

Memberships should make Thunderstrux useful beyond one-off event ticketing. The product should support societies that operate across semesters, years, and executive teams.

## 6.10 Merchandise

Thunderstrux should support organisation merchandise such as hoodies, shirts, and other society products.

### Requirements

- Organisations should be able to list merchandise.
- Members and guests should be able to purchase merchandise where enabled.
- Merchandise orders should be tracked.
- Product details such as name, description, price, images, and availability should be supported.

### Product Expectations

Merchandise should integrate naturally with organisation profiles, payments, and member engagement. It should not feel like a separate unrelated shop.

## 6.11 Analytics

Thunderstrux should provide useful analytics for organisations.

### Requirements

Analytics should help organisers understand:

- event revenue
- ticket sales
- attendance
- check-in rates
- order trends
- member engagement
- organisation-level performance

### Product Expectations

Analytics should be practical rather than overwhelming. The goal is to help society organisers make better decisions, not to produce enterprise dashboards full of unnecessary complexity.

## 6.12 AI Agent Assistance: OpenClaw

Thunderstrux should include an AI assistant concept, OpenClaw, that helps users navigate and operate the platform.

### Requirements

OpenClaw should be able to assist with tasks such as:

- finding relevant organisation information
- summarising event or order data
- helping organisers understand what actions are available
- guiding users through workflows
- assisting with administrative tasks
- exposing approved product actions through safe interfaces

### Product Expectations

OpenClaw should be action-oriented but controlled. It should help users complete tasks inside Thunderstrux without bypassing permission checks, payment safety, auditability, or user confirmation where needed.

## 7. Dashboard Experience

Thunderstrux should provide role-aware dashboards.

### Member Dashboard

The member dashboard should focus on:

- upcoming tickets
- joined organisations
- memberships
- relevant events
- purchases
- account settings

### Organisation Dashboard

The organisation dashboard should focus on:

- event management
- ticket sales
- orders
- payments
- analytics
- membership management
- merchandise
- organisation settings
- AI-assisted actions

### Product Expectations

Dashboards should prioritise the actions each user type is most likely to perform. Navigation should be simple, predictable, and difficult to misuse.

## 8. Permissions and Access Control

Thunderstrux should enforce clear access control across all product areas.

### Requirements

- Public users should only access public information.
- Members should only access their own private information unless granted additional permissions.
- Organisation users should manage their own organisation.
- Organisation data should not leak across accounts.
- Server-side checks should protect all sensitive actions.
- UI visibility should not be the only layer of protection.

### Product Expectations

Access control should be treated as a core product requirement, not a UI enhancement. Every management action must verify that the user is allowed to perform it.

## 9. Data and Audit Expectations

Thunderstrux should preserve important business and operational records.

### Requirements

The system should retain accurate records for:

- organisations
- users
- memberships
- events
- ticket types
- orders
- tickets
- payments
- check-ins
- merchandise orders
- important administrative actions

### Product Expectations

Historical records should remain meaningful after later edits. For example, an order should preserve the price and details that applied when the purchase occurred, even if the ticket type changes later.

## 10. User Experience Standards

Thunderstrux should feel modern, clean, and trustworthy.

### Requirements

- Interfaces should be responsive and accessible.
- Primary actions should be obvious.
- Error messages should be clear and useful.
- Empty states should explain what to do next.
- Forms should guide users away from invalid submissions.
- Public-facing pages should look polished and credible.
- Organisation tools should favour clarity over visual clutter.

### Product Expectations

The product should be simple enough for student organisers to use without training, while still being powerful enough to run real society operations.

## 11. Reliability Requirements

Thunderstrux should be reliable for workflows involving money, attendance, and organisational records.

### Requirements

- Payment events should be handled safely.
- Checkout fulfilment should be idempotent.
- Event publishing rules should prevent invalid public states.
- Ticket inventory should remain consistent.
- Private organisation data should remain protected.
- Failures should be recoverable where possible.
- Important actions should produce clear success or failure feedback.

### Product Expectations

Reliability matters most in flows where mistakes create real-world harm: payments, ticket issuance, attendance, permissions, and organisation ownership.

## 12. Pricing and Value Philosophy

Thunderstrux should deliver strong value for student societies and community organisations.

### Requirements

- Pricing should be competitive against existing event and ticketing platforms.
- Fees should be understandable.
- The product should justify cost through reduced admin work, integrated workflows, and society-specific tools.
- The platform should avoid unnecessary enterprise complexity that makes the product feel unsuitable for student organisations.

### Product Expectations

Thunderstrux should feel like a better fit for societies than generic ticketing platforms, both in functionality and value.

## 13. Product Boundaries

Thunderstrux should avoid becoming unfocused.

The product is not intended to be:

- a generic social media platform
- a full university learning management system
- a replacement for all communication platforms
- an enterprise resource planning system
- a generic e-commerce marketplace unrelated to societies
- a payment processor by itself

Thunderstrux should integrate or interoperate with external services where appropriate, while keeping the core product focused on society operations.

## 14. Codex Session Guidance

This document should be used as the stable product guide for Codex sessions working on Thunderstrux.

When making changes, Codex should preserve the following product intent:

- Thunderstrux is a society-first operating platform.
- Organisation and member experiences must remain clearly separated.
- Event, ticketing, checkout, and payment flows must prioritise correctness.
- Public pages must never expose invalid or private states.
- Organisation management actions must be permission-checked server-side.
- Historical financial and ticketing records must remain accurate.
- AI assistance should work through safe, auditable product actions.
- User experience should remain simple, clear, and suitable for student societies.
- The platform should be extensible without creating disconnected feature silos.

Codex should avoid implementing features in a way that violates these principles, even if the individual code change appears small.

## 15. Definition of Product Fit

A Thunderstrux feature is product-aligned when it helps organisations or members perform society-related work more clearly, safely, and efficiently.

A feature should generally be considered aligned if it improves one or more of the following:

- event creation or attendance
- ticketing or checkout reliability
- organisation administration
- member engagement
- payment readiness or transparency
- society handover
- analytics and decision-making
- merchandise or membership workflows
- AI-assisted navigation or administration

A feature should be questioned if it adds complexity without improving the society operating experience.

## 16. Final Product Statement

Thunderstrux exists to help student societies and community organisations run better.

It should centralise the tools societies need most: events, tickets, payments, members, merchandise, analytics, and AI-assisted administration. The product should be simple enough for volunteers and student organisers, reliable enough for payments and attendance, and structured enough to support long-term organisational continuity.

Every implementation decision should support that purpose.
