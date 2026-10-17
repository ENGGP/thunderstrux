import { commerceCheckoutRoute } from "@/lib/commerce/http";

// Checkout for a membership purchase (T21); see lib/commerce/http.ts.
export const POST = (request: Request) => commerceCheckoutRoute(request, "membership");
