import { NextResponse } from "next/server";
import { readBodyUpTo } from "@/lib/api/request";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logWarn } from "@/lib/ops/logger";
import { emitMetric } from "@/lib/ops/metrics";

// A webhook has to read its body before it can check the signature, so anyone can
// send one. Stripe's events are far smaller than this (SEC-041).
const maxWebhookBodyBytes = 1_000_000;

export async function readWebhookBody(request: Request, webhook: string) {
  const rawBody = await readBodyUpTo(request, maxWebhookBodyBytes);
  if (rawBody !== null) return { rawBody };
  logWarn("stripe.webhook.body_too_large", { webhook, declaredBytes: request.headers.get("content-length") });
  emitMetric("stripe_webhook_body_too_large_total", 1, { webhook });
  emitOperationalAlert("stripe_webhook_body_too_large", { webhook });
  return { refused: NextResponse.json({ error: "Request body is too large" }, { status: 413 }) };
}
