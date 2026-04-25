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

function parseMetadataQuantity(quantity: string | undefined) {
  if (!quantity) {
    return null;
  }

  const parsedQuantity = Number(quantity);

  return Number.isInteger(parsedQuantity) && parsedQuantity > 0
    ? parsedQuantity
    : null;
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
      const orderId = metadata?.orderId;
      const eventId = metadata?.eventId;
      const organisationId = metadata?.organisationId;
      const ticketTypeId = metadata?.ticketTypeId;
      const metadataQuantity = parseMetadataQuantity(metadata?.quantity);

      if (!orderId || !eventId || !organisationId || !ticketTypeId || !metadataQuantity) {
        reconciliationError("Stripe session missing required metadata", {
          stripeSessionId: session.id,
          metadata
        });
        return NextResponse.json({ received: true });
      }

      await prisma.$transaction(
        async (tx) => {
          const order = await tx.order.findUnique({
            where: { id: orderId },
            select: {
              id: true,
              status: true,
              organisationId: true,
              eventId: true,
              ticketTypeId: true,
              quantity: true,
              unitPrice: true,
              totalAmount: true,
              stripeSessionId: true,
              paidAt: true,
              failedAt: true,
              failureReason: true,
              tickets: {
                select: { id: true }
              }
            }
          });

          if (!order) {
            reconciliationError("Local order not found for Stripe session", {
              stripeSessionId: session.id,
              metadataOrderId: orderId
            });
            return;
          }

          const localOrder = order;

          if (localOrder.status === "paid") {
            if (localOrder.tickets.length !== localOrder.quantity) {
              reconciliationError("Paid order ticket count does not match quantity", {
                orderId: localOrder.id,
                stripeSessionId: session.id,
                expectedQuantity: localOrder.quantity,
                issuedTickets: localOrder.tickets.length
              });
            }

            return;
          }

          if (localOrder.status === "failed") {
            reconciliationError("Order is not pending", {
              orderId: localOrder.id,
              status: localOrder.status,
              stripeSessionId: session.id,
              failureReason: localOrder.failureReason
            });
            return;
          }

          if (localOrder.status !== "pending") {
            reconciliationError("Order is not pending", {
              orderId: localOrder.id,
              status: localOrder.status,
              stripeSessionId: session.id
            });
            return;
          }

          async function failOrder(reason: string, details: Record<string, unknown>) {
            reconciliationError(reason, {
              orderId: localOrder.id,
              stripeSessionId: session.id,
              ...details
            });

            await tx.order.update({
              where: { id: localOrder.id },
              data: {
                status: "failed",
                stripeSessionId: localOrder.stripeSessionId ?? session.id,
                failedAt: new Date(),
                failureReason: reason
              }
            });
          }

          if (
            localOrder.stripeSessionId &&
            localOrder.stripeSessionId !== session.id
          ) {
            await failOrder("Stripe session id does not match local order", {
              sessionId: session.id,
              orderStripeSessionId: localOrder.stripeSessionId
            });
            return;
          }

          if (session.payment_status !== "paid") {
            await failOrder("Stripe session is not paid", {
              paymentStatus: session.payment_status
            });
            return;
          }

          if (session.amount_total !== localOrder.totalAmount) {
            await failOrder("Stripe amount does not match local order", {
              stripeAmountTotal: session.amount_total,
              orderTotalAmount: localOrder.totalAmount
            });
            return;
          }

          if (session.currency?.toLowerCase() !== expectedCurrency) {
            await failOrder("Stripe currency does not match expected currency", {
              stripeCurrency: session.currency,
              expectedCurrency
            });
            return;
          }

          if (
            localOrder.id !== orderId ||
            localOrder.eventId !== eventId ||
            localOrder.ticketTypeId !== ticketTypeId ||
            localOrder.organisationId !== organisationId ||
            localOrder.quantity !== metadataQuantity
          ) {
            await failOrder("Stripe metadata does not match local order", {
              orderId: localOrder.id,
              metadataOrderId: orderId,
              orderEventId: localOrder.eventId,
              metadataEventId: eventId,
              orderTicketTypeId: localOrder.ticketTypeId,
              metadataTicketTypeId: ticketTypeId,
              orderOrganisationId: localOrder.organisationId,
              metadataOrganisationId: organisationId,
              orderQuantity: localOrder.quantity,
              metadataQuantity
            });
            return;
          }

          const paidAt = new Date();
          const claimedOrder = await tx.order.updateMany({
            where: {
              id: localOrder.id,
              status: "pending"
            },
            data: {
              status: "paid",
              stripeSessionId: session.id,
              paidAt,
              failedAt: null,
              failureReason: null
            }
          });

          if (claimedOrder.count === 0) {
            return;
          }

          const inventoryUpdate = await tx.ticketType.updateMany({
            where: {
              id: localOrder.ticketTypeId,
              eventId: localOrder.eventId,
              quantity: {
                gte: localOrder.quantity
              }
            },
            data: {
              quantity: {
                decrement: localOrder.quantity
              }
            }
          });

          if (inventoryUpdate.count === 0) {
            await tx.order.update({
              where: { id: localOrder.id },
              data: {
                status: "failed",
                stripeSessionId: localOrder.stripeSessionId ?? session.id,
                paidAt: null,
                failedAt: new Date(),
                failureReason:
                  "Insufficient ticket inventory for paid checkout session"
              }
            });

            reconciliationError(
              "Insufficient ticket inventory for paid checkout session",
              {
                orderId: localOrder.id,
                stripeSessionId: session.id,
                ticketTypeId: localOrder.ticketTypeId,
                requestedQuantity: localOrder.quantity
              }
            );
            return;
          }

          await tx.ticket.createMany({
            data: Array.from({ length: localOrder.quantity }, () => ({
              orderId: localOrder.id,
              eventId: localOrder.eventId,
              ticketTypeId: localOrder.ticketTypeId,
              organisationId: localOrder.organisationId
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
