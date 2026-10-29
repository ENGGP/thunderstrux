import { productMutation } from "@/lib/merchandise/http";
import { markPickupsReady, pickupBatchSchema } from "@/lib/merchandise/pickups";

type Context = { params: Promise<{ orgSlug: string }> };

// Body: { orders: [{ orderId, expectedVersion }] } (1 to 25), marked ready one by
// one (UI-018). Needs live merchandise:fulfil; answers which were marked and which
// were skipped, and why.
export async function POST(request: Request, context: Context) {
  const { orgSlug } = await context.params;
  return productMutation(request, orgSlug, pickupBatchSchema, "pickup_batch", (actor, organisationId, input) => markPickupsReady(actor, organisationId, input.orders), 200, {
    permission: "merchandise:fulfil",
    key: "pickups"
  });
}
