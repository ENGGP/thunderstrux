import { useRef, useState } from "react";
import { useResetOnRestore } from "@/components/purchases/phone-action-bar";
import { fetchJson } from "@/lib/client/api";

// What every checkout button (tickets, memberships T24a, merchandise T27b) shares.

export type CheckoutResponse = { kind: "stripe"; url: string } | { kind: "fulfilled"; orderId: string } | { kind: "fulfilled"; commerceOrderId: string } | { attemptId: string; status: "processing" };
type AttemptStatus = { status: "processing" } | { status: "ready"; url: string } | { status: "completed"; orderId: string } | { status: "failed" };

const pollIntervalMs = 2000;
const pollAttempts = 15;

// One key per purchase intent. Random bytes work outside secure contexts too, unlike crypto.randomUUID.
export const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");

// Stripe's answer was not known when checkout returned: poll the attempt for
// about half a minute. `slow` means it is still confirming.
export async function waitForAttempt(attemptId: string, failedMessage = "Checkout didn't start. Nothing has been charged."): Promise<{ url: string } | { orderId: string } | "slow"> {
  for (let poll = 0; poll < pollAttempts; poll += 1) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const attempt = await fetchJson<AttemptStatus>(`/api/payments/checkout/attempts/${attemptId}`);
    if (attempt.status === "ready") return { url: attempt.url };
    if (attempt.status === "completed") return { orderId: attempt.orderId };
    if (attempt.status === "failed") throw new Error(failedMessage);
  }
  return "slow";
}

// A Pay button's run: post the purchase, then open Stripe, finish, or poll. A
// double click, a retry after a lost response and a retry after a slow Stripe
// reuse the key and find the same checkout. Anything else that goes wrong settles
// the intent, a failed attempt included, so the next press starts a new one.
export function useCheckout({ finished, slow, refused, failedMessage }: {
  finished: (orderId: string) => void;
  slow: () => void;
  refused: (failure: unknown) => void;
  failedMessage?: string;
}) {
  const key = useRef<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "confirming">("idle");
  useResetOnRestore(() => setState("idle"));

  async function start(post: (idempotencyKey: string) => Promise<CheckoutResponse>) {
    setState("busy");
    key.current ??= newKey();
    try {
      const data = await post(key.current);
      if ("kind" in data && data.kind === "fulfilled") return finished("orderId" in data ? data.orderId : data.commerceOrderId);
      if ("kind" in data) {
        window.location.href = data.url;
        return;
      }
      setState("confirming");
      const outcome = await waitForAttempt(data.attemptId, failedMessage);
      if (outcome === "slow") {
        setState("idle");
        slow();
      } else if ("url" in outcome) window.location.href = outcome.url;
      else finished(outcome.orderId);
    } catch (failure) {
      setState("idle");
      if (!(failure instanceof TypeError)) key.current = null;
      refused(failure);
    }
  }

  return { state, start };
}
