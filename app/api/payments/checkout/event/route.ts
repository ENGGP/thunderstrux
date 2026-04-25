import { NextResponse } from "next/server";
import {
  badRequest,
  internalError,
  notFound,
  unauthorized,
  validationError
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  requireAuthenticatedUser
} from "@/lib/auth/access";
import { prisma } from "@/lib/db";
import { getAppUrl, getStripe } from "@/lib/stripe";
import { isOrganisationStripeReady } from "@/lib/stripe/connect";
import { calculatePlatformFee } from "@/lib/stripe/fees";
import { validateJson } from "@/lib/validators";
import { createEventCheckoutSchema } from "@/lib/validators/payments";

export async function POST(request: Request) {
  const validation = await validateJson(request, createEventCheckoutSchema);

  if (!validation.success) {
    return validationError(validation.details);
  }

  let pendingOrderId: string | null = null;

  try {
    const user = await requireAuthenticatedUser();
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

    if (ticketType.quantity < validation.data.quantity) {
      return badRequest("Not enough tickets available", [
        { path: ["quantity"], message: "Requested quantity exceeds availability" }
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
    const pendingOrder = await prisma.order.create({
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

    pendingOrderId = pendingOrder.id;

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
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
      await prisma.order.update({
        where: { id: pendingOrder.id },
        data: {
          status: "failed",
          failedAt: new Date(),
          failureReason: "Stripe Checkout Session did not include a redirect URL"
        }
      });
      return internalError();
    }

    await prisma.order.update({
      where: { id: pendingOrder.id },
      data: {
        stripeSessionId: session.id
      }
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (pendingOrderId) {
      await prisma.order.update({
        where: { id: pendingOrderId },
        data: {
          status: "failed",
          failedAt: new Date(),
          failureReason: "Failed to create Stripe Checkout Session"
        }
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
