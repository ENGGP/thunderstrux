import { productMutation, productRead } from "@/lib/merchandise/http";
import { createProduct, listProducts, productFieldsSchema } from "@/lib/merchandise/catalogue";

type Context = { params: Promise<{ orgSlug: string }> };

// The society's products, for staff with merchandise:manage.
export async function GET(request: Request, context: Context) {
  return productRead(request, (await context.params).orgSlug, listProducts);
}

// Create a draft product with its photos and options.
export async function POST(request: Request, context: Context) {
  return productMutation(request, (await context.params).orgSlug, productFieldsSchema, "create", createProduct, 201);
}
