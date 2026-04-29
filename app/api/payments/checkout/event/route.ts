import { NextResponse } from "next/server";
import {
  badRequest,
  internalError,
  notFound,
  serviceUnavailable,
  unauthorized,
  validationError
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  requireAuthenticatedUser
} from "@/lib/auth/access";
import { prisma } from "@/lib/db";
import { getAppUrl, getStripe, StripeConfigurationError } from "@/lib/stripe";
import { isOrganisationStripeReady } from "@/lib/stripe/connect";
import { calculatePlatformFee } from "@/lib/stripe/fees";
import { validateJson } from "@/lib/validators";
import { createEventCheckoutSchema } from "@/lib/validators/payments";
import { failStalePreCheckoutOrders } from "@/lib/orders/stale-orders";
import {
  expireOldActiveReservations,
  getActiveReservedQuantity,
  getReservationExpiry,
  reservationMinutes,
  releaseReservationForOrder,
  runSerializableReservationTransaction
} from "@/lib/tickets/reservations";

class CheckoutAvailabilityError extends Error {
  details: Array<{ path: string[]; message: string }>;

  constructor(message: string, details: Array<{ path: string[]; message: string }>) {
    super(message);
    this.name = "CheckoutAvailabilityError";
    this.details = details;
  }
}

export async function POST(request: Request) {
  const validation = await validateJson(request, createEventCheckoutSchema);

  if (!validation.success) {
    return validationError(validation.details);
  }

  let pendingOrderId: string | null = null;

  try {
    const user = await requireAuthenticatedUser();

    if (user.accountRole !== "member") {
      return badRequest("Member account required", [
        { path: ["accountRole"], message: "Only member accounts can buy tickets" }
      ]);
    }

    await failStalePreCheckoutOrders({ userId: user.id });

    const event = await prisma.event.findFirst({
      where: {
        id: validation.data.eventId
      },
      select: {
        id: true,
        title: true,
        status: true,
        organisationId: true,
        organisation: {
          select: {
            id: true,
            stripeAccountId: true,
            stripeChargesEnabled: true
          }
        },
        ticketTypes: {
          where: { id: validation.data.ticketTypeId },
          select: {
            id: true,
            name: true,
            price: true,
            quantity: true
          },
          take: 1
        }
      }
    });

    if (!event) {
      return notFound("Event was not found");
    }

    if (event.status !== "published") {
      return badRequest("Event is draft", [
        {
          path: ["eventId"],
          message: "Event must be published before tickets can be purchased"
        }
      ]);
    }

    const organisationId = event.organisationId;
    const organisation = event.organisation;
    const ticketType = event.ticketTypes[0];

    if (!ticketType) {
      return notFound("Ticket type was not found for this event");
    }

    if (ticketType.quantity <= 0) {
      return badRequest("Tickets are sold out", [
        { path: ["ticketTypeId"], message: "Ticket type has no remaining inventory" }
      ]);
    }

    if (!organisation.stripeAccountId) {
      return badRequest("Stripe not connected", [
        {
          path: ["eventId"],
          message: "Event organiser must complete Stripe onboarding before accepting payments"
        }
      ]);
    }

    if (!isOrganisationStripeReady(organisation)) {
      return badRequest("Stripe not connected", [
        {
          path: ["eventId"],
          message: "Connected Stripe account does not have charges enabled"
        }
      ]);
    }

    const totalAmount = ticketType.price * validation.data.quantity;

    if (totalAmount <= 0) {
      return badRequest("Invalid checkout amount", [
        { path: ["ticketTypeId"], message: "Ticket price must be greater than zero" }
      ]);
    }

    const platformFeeAmount = calculatePlatformFee(totalAmount);
    const stripe = getStripe();
    const appUrl = getAppUrl();
    const reservationNow = new Date();
    const reservationExpiresAt = getReservationExpiry(reservationNow);

    console.info("Stripe checkout creation started", {
      eventId: event.id,
      organisationId,
      ticketTypeId: ticketType.id,
      quantity: validation.data.quantity,
      totalAmount,
      platformFeeAmount
    });

    const pendingOrder = await runSerializableReservationTransaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "TicketType" WHERE id = ${ticketType.id} FOR UPDATE`;
        await expireOldActiveReservations(tx, {
          now: reservationNow,
          ticketTypeId: ticketType.id
        });

        const lockedTicketType = await tx.ticketType.findFirst({
          where: {
            id: ticketType.id,
            eventId: event.id
          },
          select: {
            id: true,
            quantity: true
          }
        });

        if (!lockedTicketType) {
          throw new CheckoutAvailabilityError("Ticket type was not found", [
            { path: ["ticketTypeId"], message: "Ticket type was not found for this event" }
          ]);
        }

        const activeReservedQuantity = await getActiveReservedQuantity(
          tx,
          lockedTicketType.id,
          reservationNow
        );
        const availableNow = lockedTicketType.quantity - activeReservedQuantity;

        if (availableNow <= 0) {
          throw new CheckoutAvailabilityError("Tickets are sold out", [
            {
              path: ["ticketTypeId"],
              message: "Ticket type has no remaining inventory"
            }
          ]);
        }

        if (availableNow < validation.data.quantity) {
          throw new CheckoutAvailabilityError("Not enough tickets available", [
            {
              path: ["quantity"],
              message: "Requested quantity exceeds availability"
            }
          ]);
        }

        const order = await tx.order.create({
          data: {
            organisationId,
            eventId: event.id,
            ticketTypeId: ticketType.id,
            quantity: validation.data.quantity,
            unitPrice: ticketType.price,
            status: "pending",
            totalAmount,
            userId: user.id
          },
          select: { id: true }
        });

        await tx.ticketReservation.create({
          data: {
            orderId: order.id,
            organisationId,
            eventId: event.id,
            ticketTypeId: ticketType.id,
            userId: user.id,
            quantity: validation.data.quantity,
            expiresAt: reservationExpiresAt
          }
        });

        return order;
      }
    );

    pendingOrderId = pendingOrder.id;
    const stripeExpiresAt = Math.ceil(Date.now() / 1000) + reservationMinutes * 60;

    await prisma.ticketReservation.update({
      where: { orderId: pendingOrder.id },
      data: {
        expiresAt: new Date(stripeExpiresAt * 1000)
      }
    });

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "aud",
              product_data: {
                name: event.title
              },
              unit_amount: ticketType.price
            },
            quantity: validation.data.quantity
          }
        ],
        payment_intent_data: {
          application_fee_amount: platformFeeAmount,
          on_behalf_of: organisation.stripeAccountId,
          transfer_data: {
            destination: organisation.stripeAccountId
          }
        },
        success_url: `${appUrl}/success`,
        cancel_url: `${appUrl}/cancel`,
        expires_at: stripeExpiresAt,
        metadata: {
          orderId: pendingOrder.id,
          eventId: event.id,
          organisationId,
          ticketTypeId: ticketType.id,
          quantity: String(validation.data.quantity)
        }
      }
    );

    if (!session.url) {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: pendingOrder.id },
          data: {
            status: "failed",
            failedAt: new Date(),
            failureReason: "stripe_error"
          }
        });
        await releaseReservationForOrder(
          tx,
          pendingOrder.id,
          "Stripe Checkout Session did not include a redirect URL"
        );
      });
      return internalError();
    }

    await prisma.order.update({
      where: { id: pendingOrder.id },
      data: {
        stripeSessionId: session.id
      }
    });

    console.info("Stripe checkout session created", {
      orderId: pendingOrder.id,
      stripeSessionId: session.id,
      eventId: event.id,
      organisationId,
      ticketTypeId: ticketType.id
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof CheckoutAvailabilityError) {
      return badRequest(error.message, error.details);
    }

    if (error instanceof StripeConfigurationError) {
      console.error("Stripe checkout configuration error", {
        message: error.message
      });
      return serviceUnavailable(
        "Stripe is not configured. Check STRIPE_SECRET_KEY in the app container environment."
      );
    }

    if (pendingOrderId) {
      const orderId = pendingOrderId;
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: orderId },
          data: {
            status: "failed",
            failedAt: new Date(),
            failureReason: "stripe_error"
          }
        });
        await releaseReservationForOrder(
          tx,
          orderId,
          "Failed to create Stripe Checkout Session"
        );
      });
    }

    console.error("Failed to create checkout session", {
      eventId: validation.data.eventId,
      quantity: validation.data.quantity,
      ticketTypeId: validation.data.ticketTypeId,
      error
    });
    return internalError();
  }
}
