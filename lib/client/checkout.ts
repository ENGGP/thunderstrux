import { fetchJson } from "@/lib/client/api";

// What a commerce checkout button (memberships T24a, merchandise T27b) shares.

export type CommerceCheckoutResponse = { kind: "stripe"; url: string } | { kind: "fulfilled"; commerceOrderId: string } | { attemptId: string; status: "processing" };
type AttemptStatus = { status: "processing" } | { status: "ready"; url: string } | { status: "completed"; orderId: string } | { status: "failed" };

const pollIntervalMs = 2000;
const pollAttempts = 15;

// One key per purchase intent. Random bytes work outside secure contexts too, unlike crypto.randomUUID.
export const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");

// Stripe's answer was not known when checkout returned: poll the attempt for
// about half a minute. `slow` means it is still confirming.
export async function waitForAttempt(attemptId: string): Promise<{ url: string } | { orderId: string } | "slow"> {
  for (let poll = 0; poll < pollAttempts; poll += 1) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const attempt = await fetchJson<AttemptStatus>(`/api/payments/checkout/attempts/${attemptId}`);
    if (attempt.status === "ready") return { url: attempt.url };
    if (attempt.status === "completed") return { orderId: attempt.orderId };
    if (attempt.status === "failed") throw new Error("Checkout didn't start. Nothing has been charged.");
  }
  return "slow";
}
