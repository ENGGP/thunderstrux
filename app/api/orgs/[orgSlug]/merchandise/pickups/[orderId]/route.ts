import { productMutation } from "@/lib/merchandise/http";
import { markPickup, pickupStepSchema } from "@/lib/merchandise/pickups";

type Context = { params: Promise<{ orgSlug: string; orderId: string }> };

// Body: { step: "ready" | "collected", expectedVersion } (T28a). Needs live
// merchandise:fulfil; a stale version or a step someone else took is a 409.
export async function POST(request: Request, context: Context) {
  const { orgSlug, orderId } = await context.params;
  return productMutation(request, orgSlug, pickupStepSchema, "pickup", (actor, organisationId, input) => markPickup(actor, organisationId, orderId, input), 200, {
    permission: "merchandise:fulfil",
    key: "pickup"
  });
}
