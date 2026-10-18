import { productMutation } from "@/lib/merchandise/http";
import { productVersionSchema, publishProduct } from "@/lib/merchandise/catalogue";

type Context = { params: Promise<{ orgSlug: string; productId: string }> };

// Body: { expectedVersion }. Repeating it returns the product unchanged.
export async function POST(request: Request, context: Context) {
  const { orgSlug, productId } = await context.params;
  return productMutation(request, orgSlug, productVersionSchema, "publish", (actor, organisationId, input) => publishProduct(actor, organisationId, productId, input));
}
