import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import Stripe from "stripe";
import { prisma } from "@/lib/db";
import { getStripe, getStripeWebhookSecret } from "@/lib/stripe";

const expectedCurrency = "aud";
const maxTransactionAttempts = 3;

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

function isPrismaErrorCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

async function runSerializableTransaction(
  operation: (tx: Prisma.TransactionClient) => Promise<void>
) {
  for (let attempt = 1; attempt <= maxTransactionAttempts; attempt += 1) {
    try {
      await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
      return;
    } catch (error) {
      if (attempt < maxTransactionAttempts && isPrismaErrorCode(error, "P2034")) {
        console.info("Retrying Stripe webhook transaction after write conflict", {
          attempt
        });
        continue;
      }

      throw error;
    }
  }
}

async function findOrderForCheckoutSession(
  session: Stripe.Checkout.Session,
  tx: Prisma.TransactionClient
) {
  const orderId = session.metadata?.orderId;

  if (orderId) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        stripeSessionId: true,
        failureReason: true
      }
    });

    if (order) {
      return order;
    }
  }

  if (!session.id) {
    return null;
  }

  return tx.order.findUnique({
    where: { stripeSessionId: session.id },
    select: {
      id: true,
      status: true,
      stripeSessionId: true,
      failureReason: true
    }
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

    console.info("Stripe checkout webhook received", {
      stripeEventId: event.id,
      stripeSessionId: session.id,
      paymentStatus: session.payment_status
    });

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

      await runSerializableTransaction(
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
          console.info("Stripe checkout order matched", {
            orderId: localOrder.id,
            stripeSessionId: session.id,
            status: localOrder.status
          });

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
            reconciliationError("Stripe session id does not match local order", {
              orderId: localOrder.id,
              stripeSessionId: session.id,
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

          console.info("Stripe checkout reconciliation validation passed", {
            orderId: localOrder.id,
            stripeSessionId: session.id,
            quantity: localOrder.quantity,
            totalAmount: localOrder.totalAmount
          });

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

          console.info("Stripe checkout inventory updated", {
            orderId: localOrder.id,
            ticketTypeId: localOrder.ticketTypeId,
            quantity: localOrder.quantity
          });

          await tx.ticket.createMany({
            data: Array.from({ length: localOrder.quantity }, () => ({
              orderId: localOrder.id,
              eventId: localOrder.eventId,
              ticketTypeId: localOrder.ticketTypeId,
              organisationId: localOrder.organisationId
            }))
          });

          console.info("Stripe checkout tickets created", {
            orderId: localOrder.id,
            ticketCount: localOrder.quantity
          });
        }
      );
    }
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;

    console.info("Stripe checkout expired webhook received", {
      stripeEventId: event.id,
      stripeSessionId: session.id,
      metadataOrderId: session.metadata?.orderId
    });

    await runSerializableTransaction(async (tx) => {
      const order = await findOrderForCheckoutSession(session, tx);

      if (!order) {
        reconciliationError("Local order not found for expired Stripe session", {
          stripeSessionId: session.id,
          metadataOrderId: session.metadata?.orderId
        });
        return;
      }

      console.info("Stripe checkout expired order matched", {
        orderId: order.id,
        stripeSessionId: session.id,
        status: order.status
      });

      if (order.status === "paid") {
        console.info("Stripe checkout expired ignored for paid order", {
          orderId: order.id,
          stripeSessionId: session.id
        });
        return;
      }

      if (order.stripeSessionId && order.stripeSessionId !== session.id) {
        reconciliationError("Expired Stripe session id does not match local order", {
          orderId: order.id,
          stripeSessionId: session.id,
          orderStripeSessionId: order.stripeSessionId
        });
        return;
      }

      if (order.status === "failed") {
        console.info("Stripe checkout expired ignored for failed order", {
          orderId: order.id,
          stripeSessionId: session.id,
          failureReason: order.failureReason
        });
        return;
      }

      if (order.status !== "pending") {
        reconciliationError("Expired Stripe session order is not pending", {
          orderId: order.id,
          stripeSessionId: session.id,
          status: order.status
        });
        return;
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "failed",
          stripeSessionId: order.stripeSessionId ?? session.id,
          failedAt: new Date(),
          failureReason: "Stripe Checkout Session expired before payment"
        }
      });

      console.info("Stripe checkout expired order marked failed", {
        orderId: order.id,
        stripeSessionId: session.id
      });
    });
  }

  return NextResponse.json({ received: true });
}
