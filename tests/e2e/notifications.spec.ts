import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

test("bounded notification worker sends one immutable message to Docker capture", async ({ request }) => {
  execFileSync("node", ["scripts/seed-notification-e2e.mjs"], { stdio: "pipe" });
  execFileSync("node", ["scripts/process-notifications.mjs"], { stdio: "pipe" });
  execFileSync("node", ["scripts/process-notifications.mjs"], { stdio: "pipe" });
  const messages = await (await request.get("http://mail-capture:8025/messages")).json();
  const matching = messages.filter((message: { data: { to: string } }) => message.data.to === "notification-e2e@example.com");
  expect(matching).toHaveLength(1);
  expect(matching[0].data.text).toContain("http://localhost:3100/verify-email#token=synthetic-e2e");
  expect(matching[0].key).toMatch(/^notification\/notification_/);
});
