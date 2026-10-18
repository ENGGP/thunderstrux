import { productMutation } from "@/lib/merchandise/http";
import { productVersionSchema, archiveProduct } from "@/lib/merchandise/catalogue";

type Context = { params: Promise<{ orgSlug: string; productId: string }> };

// Body: { expectedVersion }. Repeating it returns the product unchanged.
export async function POST(request: Request, context: Context) {
  const { orgSlug, productId } = await context.params;
  return productMutation(request, orgSlug, productVersionSchema, "archive", (actor, organisationId, input) => archiveProduct(actor, organisationId, productId, input));
}
