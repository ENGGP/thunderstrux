import { productMutation, productRead } from "@/lib/merchandise/http";
import { readProduct, updateProduct, updateProductSchema } from "@/lib/merchandise/catalogue";

type Context = { params: Promise<{ orgSlug: string; productId: string }> };

export async function GET(request: Request, context: Context) {
  const { orgSlug, productId } = await context.params;
  return productRead(request, orgSlug, (organisationId) => readProduct(organisationId, productId));
}

// Body: the product's fields, its options (each existing one with its
// expectedVersion) and the product's expectedVersion.
export async function PATCH(request: Request, context: Context) {
  const { orgSlug, productId } = await context.params;
  return productMutation(request, orgSlug, updateProductSchema, "update", (actor, organisationId, input) => updateProduct(actor, organisationId, productId, input));
}
