import { describe, expect, test } from "vitest";
import { POST as paymentsWebhook } from "@/app/api/payments/webhook/route";
import { POST as accountsWebhook } from "@/app/api/stripe/accounts/webhook/route";
import { POST as connectWebhook } from "@/app/api/stripe/connect/webhook/route";

const tooLarge = "x".repeat(1_000_001);
const post = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/webhook", { method: "POST", headers: { "stripe-signature": "t=1,v1=unchecked", ...headers }, body: tooLarge });

describe("webhook body limit (SEC-041)", () => {
  test.each([
    ["payments", paymentsWebhook],
    ["connect", connectWebhook],
    ["accounts", accountsWebhook]
  ])("the %s webhook refuses a body over the limit, declared or not", async (_name, route) => {
    expect((await route(post())).status).toBe(413);
    expect((await route(post({ "content-length": String(tooLarge.length) }))).status).toBe(413);
  });
});
