import { productMutation } from "@/lib/merchandise/http";
import { recordReturn, returnSchema } from "@/lib/merchandise/after-sale";

type Context = { params: Promise<{ orgSlug: string; orderId: string }> };

// Body: { lineId, quantity, restock, reason, operationKey } (T28b). Records
// items handed back (merchandise:fulfil); the same key records it once.
export async function POST(request: Request, context: Context) {
  const { orgSlug, orderId } = await context.params;
  return productMutation(request, orgSlug, returnSchema, "return", (actor, organisationId, input) => recordReturn(actor, organisationId, orderId, input), 201, {
    permission: "merchandise:fulfil",
    key: "return"
  });
}
