import { prisma } from "@/lib/db";

type TicketDeliveryOrder = Awaited<ReturnType<typeof loadTicketDeliveryOrder>>;

export class TicketEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TicketEmailError";
  }
}

export class TicketEmailConfigurationError extends TicketEmailError {
  constructor(message = "Email provider is not configured") {
    super(message);
    this.name = "TicketEmailConfigurationError";
  }
}

export class TicketEmailRecipientError extends TicketEmailError {
  constructor(message = "Order buyer email is missing") {
    super(message);
    this.name = "TicketEmailRecipientError";
  }
}

export class TicketEmailOrderStateError extends TicketEmailError {
  constructor(message = "Ticket email can only be sent for paid orders") {
    super(message);
    this.name = "TicketEmailOrderStateError";
  }
}

export class TicketEmailProviderError extends TicketEmailError {
  constructor(message = "Email provider failed to send ticket email") {
    super(message);
    this.name = "TicketEmailProviderError";
  }
}

export function truncateTicketEmailError(message: string) {
  return message.slice(0, 500);
}

function formatCurrency(amountInCents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD"
  }).format(amountInCents / 100);
}

function formatDateTime(value: Date | null) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Australia/Brisbane"
  }).format(value);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function loadTicketDeliveryOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      quantity: true,
      unitPrice: true,
      totalAmount: true,
      paidAt: true,
      ticketEmailSentAt: true,
      user: {
        select: {
          email: true,
          firstName: true,
          lastName: true,
          displayName: true
        }
      },
      event: {
        select: {
          title: true,
          startTime: true,
          location: true,
          organisation: {
            select: {
              name: true
            }
          }
        }
      },
      ticketType: {
        select: {
          name: true
        }
      },
      tickets: {
        select: {
          id: true
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!order) {
    throw new TicketEmailError("Order not found");
  }

  return order;
}

function buyerName(order: TicketDeliveryOrder) {
  if (!order.user) {
    return null;
  }

  const fullName = [order.user.firstName, order.user.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  return order.user.displayName ?? (fullName || null);
}

export function renderTicketEmail(order: TicketDeliveryOrder) {
  const name = buyerName(order);
  const greeting = name ? `Hi ${name},` : "Hi,";
  const ticketIds = order.tickets.map((ticket) => ticket.id);
  const ticketIdLines = ticketIds.map((id) => `- ${id}`).join("\n");
  const ticketIdHtml = ticketIds
    .map((id) => `<li><code>${escapeHtml(id)}</code></li>`)
    .join("");
  const subject = `Your tickets for ${order.event.title}`;

  const text = [
    greeting,
    "",
    `Your payment is confirmed and your tickets for ${order.event.title} are ready.`,
    "",
    `Event: ${order.event.title}`,
    `Organiser: ${order.event.organisation.name}`,
    `Date: ${formatDateTime(order.event.startTime)}`,
    `Location: ${order.event.location}`,
    `Ticket: ${order.ticketType.name}`,
    `Quantity: ${order.quantity}`,
    `Unit price: ${formatCurrency(order.unitPrice)}`,
    `Total: ${formatCurrency(order.totalAmount)}`,
    `Order ID: ${order.id}`,
    "",
    "Ticket IDs:",
    ticketIdLines || "- Not available",
    "",
    "QR scanning is not required for this MVP. Keep this email or your ticket IDs handy for the event."
  ].join("\n");

  const html = `
    <div>
      <p>${escapeHtml(greeting)}</p>
      <p>Your payment is confirmed and your tickets for <strong>${escapeHtml(
        order.event.title
      )}</strong> are ready.</p>
      <dl>
        <dt>Event</dt><dd>${escapeHtml(order.event.title)}</dd>
        <dt>Organiser</dt><dd>${escapeHtml(order.event.organisation.name)}</dd>
        <dt>Date</dt><dd>${escapeHtml(formatDateTime(order.event.startTime))}</dd>
        <dt>Location</dt><dd>${escapeHtml(order.event.location)}</dd>
        <dt>Ticket</dt><dd>${escapeHtml(order.ticketType.name)}</dd>
        <dt>Quantity</dt><dd>${order.quantity}</dd>
        <dt>Unit price</dt><dd>${escapeHtml(formatCurrency(order.unitPrice))}</dd>
        <dt>Total</dt><dd>${escapeHtml(formatCurrency(order.totalAmount))}</dd>
        <dt>Order ID</dt><dd><code>${escapeHtml(order.id)}</code></dd>
      </dl>
      <p><strong>Ticket IDs</strong></p>
      <ul>${ticketIdHtml || "<li>Not available</li>"}</ul>
      <p>QR scanning is not required for this MVP. Keep this email or your ticket IDs handy for the event.</p>
    </div>
  `;

  return { subject, text, html };
}

export async function sendWithResend({
  to,
  subject,
  text,
  html,
  idempotencyKey
}: {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey?: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    throw new TicketEmailConfigurationError();
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json"
  };

  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify({
      from,
      to,
      subject,
      text,
      html
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new TicketEmailProviderError(
      `Email provider failed with status ${response.status}${body ? `: ${body}` : ""}`
    );
  }

  const body = await response.json().catch(() => null);
  return {
    providerMessageId:
      body &&
      typeof body === "object" &&
      "id" in body &&
      typeof body.id === "string"
        ? body.id
        : null
  };
}

export async function sendTicketDeliveryEmailToProvider(
  orderId: string,
  {
    idempotencyKey
  }: {
    idempotencyKey?: string;
  } = {}
) {
  const order = await loadTicketDeliveryOrder(orderId);

  if (order.status !== "paid") {
    throw new TicketEmailOrderStateError();
  }

  const recipient = order.user?.email;

  if (!recipient) {
    throw new TicketEmailRecipientError();
  }

  const email = renderTicketEmail(order);
  const delivery = await sendWithResend({
    to: recipient,
    idempotencyKey,
    ...email
  });

  return { order, providerMessageId: delivery.providerMessageId };
}
