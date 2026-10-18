import { NextResponse } from "next/server";
import { mapRouteError, notFound, validationError } from "@/lib/api/errors";
import { quoteBasket, quoteSchema } from "@/lib/merchandise/shop";
import { validateJson } from "@/lib/validators";

// POST /api/merchandise/quote (T26): prices a basket of one society's options
// against today's catalogue and stock. Anyone may ask; nothing is held or
// changed, so there is no CSRF or session. Body: { society, items: [{variantId, quantity}] }.
export async function POST(request: Request) {
  try {
    const body = await validateJson(request, quoteSchema);
    if (!body.success) return validationError(body.details);
    const quote = await quoteBasket(body.data);
    if (!quote) return notFound("Society not found");
    return NextResponse.json({ quote }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapRouteError(error, { operation: "merchandise.quote", request });
  }
}
