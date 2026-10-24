import { cancelPendingCheckoutRoute } from "@/lib/purchases/pending-checkout-http";

// The buyer cancels their unpaid membership or merchandise order (round E1); see the helper.
export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  return cancelPendingCheckoutRoute(request, "commerce", (await context.params).orderId);
}
