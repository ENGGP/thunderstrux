import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import Stripe from "stripe";
import { prisma } from "@/lib/db";
import { getStripe, getStripeWebhookSecret } from "@/lib/stripe";

const expectedCurrency = "aud";

function reconciliationError(message: string, details: Record<string, unknown>) {
  console.error("Stripe checkout reconciliation failed", {
    message,
    ...details
  });
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });
  }

  const rawBody = await request.text();
  const stripe = getStripe();
  const webhookSecret = getStripeWebhookSecret();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    if (session.id) {
      const metadata = session.metadata;
      const eventId = metadata?.eventId;
      const organisationId = metadata?.organisationId;
      const ticketTypeId = metadata?.ticketTypeId;

      if (!eventId || !organisationId || !ticketTypeId) {
        reconciliationError("Stripe session missing required metadata", {
          stripeSessionId: session.id,
          metadata
        });
        return NextResponse.json({ received: true });
      }

      await prisma.$transaction(
        async (tx) => {
          const order = await tx.order.findUnique({
            where: { stripeSessionId: session.id },
            select: {
              id: true,
              status: true,
              organisationId: true,
              eventId: true,
              ticketTypeId: true,
              quantity: true,
              unitPrice: true,
              totalAmount: true,
              stripeSessionId: true
            }
          });

          if (!order) {
            reconciliationError("Local order not found for Stripe session", {
              stripeSessionId: session.id
            });
            return;
          }

          if (order.status === "paid") {
            return;
          }

          if (order.status !== "pending") {
            reconciliationError("Order is not pending", {
              orderId: order.id,
              status: order.status,
              stripeSessionId: session.id
            });
            return;
          }

          if (order.stripeSessionId !== session.id) {
            reconciliationError("Stripe session id does not match local order", {
              orderId: order.id,
              sessionId: session.id,
              orderStripeSessionId: order.stripeSessionId
            });
            return;
          }

          if (session.amount_total !== order.totalAmount) {
            reconciliationError("Stripe amount does not match local order", {
              orderId: order.id,
              stripeSessionId: session.id,
              stripeAmountTotal: session.amount_total,
              orderTotalAmount: order.totalAmount
            });
            return;
          }

          if (session.currency !== expectedCurrency) {
            reconciliationError("Stripe currency does not match expected currency", {
              orderId: order.id,
              stripeSessionId: session.id,
              stripeCurrency: session.currency,
              expectedCurrency
            });
            return;
          }

          if (
            order.eventId !== eventId ||
            order.ticketTypeId !== ticketTypeId ||
            order.organisationId !== organisationId
          ) {
            reconciliationError("Stripe metadata does not match local order", {
              orderId: order.id,
              stripeSessionId: session.id,
              orderEventId: order.eventId,
              metadataEventId: eventId,
              orderTicketTypeId: order.ticketTypeId,
              metadataTicketTypeId: ticketTypeId,
              orderOrganisationId: order.organisationId,
              metadataOrganisationId: organisationId
            });
            return;
          }

          const claimedOrder = await tx.order.updateMany({
            where: {
              id: order.id,
              status: "pending"
            },
            data: { status: "paid" }
          });

          if (claimedOrder.count === 0) {
            return;
          }

          const inventoryUpdate = await tx.ticketType.updateMany({
            where: {
              id: order.ticketTypeId,
              eventId: order.eventId,
              quantity: {
                gte: order.quantity
              }
            },
            data: {
              quantity: {
                decrement: order.quantity
              }
            }
          });

          if (inventoryUpdate.count === 0) {
            throw new Error("Insufficient ticket inventory for paid checkout session");
          }

          await tx.ticket.createMany({
            data: Array.from({ length: order.quantity }, () => ({
              orderId: order.id,
              eventId: order.eventId,
              ticketTypeId: order.ticketTypeId,
              organisationId: order.organisationId
            }))
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }
      );
    }
  }

  return NextResponse.json({ received: true });
}
