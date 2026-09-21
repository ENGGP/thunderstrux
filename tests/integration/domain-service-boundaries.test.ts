import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const routeFiles = [
  "app/api/payments/checkout/event/route.ts",
  "app/api/payments/webhook/route.ts",
  "app/api/events/route.ts",
  "app/api/events/[eventId]/route.ts",
  "app/api/events/[eventId]/publish/route.ts",
  "app/api/events/[eventId]/ticket-types/route.ts",
  "app/api/orders/route.ts",
  "app/api/orders/[orderId]/route.ts",
  "app/api/orders/[orderId]/refund-manual/route.ts",
  "app/api/orders/[orderId]/resend/route.ts",
  "app/api/tickets/[ticketId]/check-in/route.ts",
  "app/api/tickets/[ticketId]/check-out/route.ts",
  "app/api/stripe/connect/status/route.ts",
  "app/api/stripe/connect/onboard/route.ts",
  "app/api/stripe/connect/continue/route.ts",
  "app/api/stripe/connect/disconnect/route.ts",
  "app/api/stripe/connect/webhook/route.ts"
] as const;

async function source(path: string) {
  return readFile(path, "utf8");
}

function expectInOrder(content: string, markers: string[]) {
  let previousIndex = -1;

  for (const marker of markers) {
    const index = content.indexOf(marker, previousIndex + 1);
    expect(index, `Expected ${marker} after the previous guard`).toBeGreaterThan(
      previousIndex
    );
    previousIndex = index;
  }
}

describe("domain service boundaries", () => {
  test("affected route adapters do not access Prisma directly", async () => {
    for (const path of routeFiles) {
      const content = await source(path);
      expect(content, path).not.toMatch(/from ["']@\/lib\/db["']/);
      expect(content, path).not.toContain("prisma.");
      expect(content, path).not.toContain("prisma.$transaction");
    }
  });

  test("checkout keeps origin, validation, authentication and rate limiting before creation", async () => {
    expectInOrder(await source(routeFiles[0]), [
      "enforceTrustedMutationRequest(request)",
      "validateJson(request, createEventCheckoutSchema)",
      "requireAuthenticatedUser()",
      "enforceRateLimit({",
      "createEventCheckout({"
    ]);
  });

  test("event mutations retain their established guard ordering", async () => {
    const collectionRoute = await source("app/api/events/route.ts");
    const eventRoute = await source("app/api/events/[eventId]/route.ts");
    const ticketTypeRoute = await source(
      "app/api/events/[eventId]/ticket-types/route.ts"
    );

    expectInOrder(collectionRoute, [
      "enforceTrustedMutationRequest(request)",
      "validateJson(request, createEventSchema)",
      "requireOrganisationEventManagementAccess(organisationId)",
      "createOrganisationEvent(organisationId, validation.data)"
    ]);
    expectInOrder(eventRoute, [
      "enforceTrustedMutationRequest(request)",
      "requireCurrentOrganisationAccount()",
      "requireOrganisationEventManagementAccess(organisation.id)",
      "validateJson(request, updateEventSchema)",
      "updateOrganisationEvent("
    ]);
    expectInOrder(ticketTypeRoute, [
      "enforceTrustedMutationRequest(request)",
      "validateJson(request, createScopedTicketTypeSchema)",
      "requireOrganisationEventManagementAccess(organisationId)",
      "createOrganisationEventTicketType("
    ]);
  });

  test("order resend remains a two-phase tenant-safe operation", async () => {
    expectInOrder(await source("app/api/orders/[orderId]/resend/route.ts"), [
      "enforceTrustedMutationRequest(request)",
      "requireCurrentOrganisationAccount()",
      'requireOrganisationPermission(organisation.id, "orders:email_resend")',
      "getOrganisationOrderResendTarget(",
      "enforceRateLimit({",
      "requireAuthenticatedUser()",
      "enqueueOrganisationOrderTicketEmail("
    ]);
  });

  test("Connect mutations authorize the target tenant before rate limiting and I/O", async () => {
    const cases = [
      ["onboard", "startOrganisationStripeOnboarding(organisationId)"],
      ["continue", "continueOrganisationStripeOnboarding(organisationId)"],
      ["disconnect", "disconnectAccount(organisationId)"]
    ] as const;

    for (const [action, operation] of cases) {
      const content = await source(`app/api/stripe/connect/${action}/route.ts`);
      expectInOrder(content, [
        "enforceTrustedMutationRequest(request)",
        "requireStripeConnectCapability()",
        "validateJson(request, organisationConnectSchema)",
        "requireOrganisationStripeConnectAccess(organisationId)",
        "enforceRateLimit({",
        operation
      ]);
    }
  });

  test("webhooks verify their raw signed body before reconciliation", async () => {
    expectInOrder(await source("app/api/payments/webhook/route.ts"), [
      'request.headers.get("stripe-signature")',
      "request.text()",
      "getStripe()",
      "stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)",
      "reconcileCompletedCheckoutSessionWithSideEffects(session"
    ]);
  });
});
