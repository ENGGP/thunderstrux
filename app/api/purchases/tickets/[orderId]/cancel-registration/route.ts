import { releaseFreeRegistrationRoute } from "@/lib/purchases/pending-checkout-http";

// The buyer releases their own free registration (EVT-005); see the helper.
export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  return releaseFreeRegistrationRoute(request, (await context.params).orderId);
}
