import type Stripe from "stripe";
import { unique } from "@/tests/helpers/test-data";

export function checkoutSession({
  id = unique("cs_mock"),
  orderId,
  eventId,
  organisationId,
  ticketTypeId,
  quantity,
  amountTotal,
  currency = "aud",
  paymentStatus = "paid"
}: {
  id?: string;
  orderId?: string;
  eventId?: string;
  organisationId?: string;
  ticketTypeId?: string;
  quantity?: number | string;
  amountTotal?: number | null;
  currency?: string | null;
  paymentStatus?: Stripe.Checkout.Session["payment_status"];
}) {
  return {
    id,
    payment_status: paymentStatus,
    amount_total: amountTotal,
    currency,
    metadata: {
      ...(orderId ? { orderId } : {}),
      ...(eventId ? { eventId } : {}),
      ...(organisationId ? { organisationId } : {}),
      ...(ticketTypeId ? { ticketTypeId } : {}),
      ...(quantity !== undefined ? { quantity: String(quantity) } : {})
    }
  } as Stripe.Checkout.Session;
}
