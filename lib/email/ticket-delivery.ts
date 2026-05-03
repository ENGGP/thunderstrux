import { prisma } from "@/lib/db";

type DeliveryMode = "automatic" | "manual";

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

function truncateError(message: string) {
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

async function loadTicketDeliveryOrder(orderId: string) {
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

function renderTicketEmail(order: TicketDeliveryOrder) {
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

async function recordTicketEmailFailure(orderId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown email failure";

  await prisma.order.update({
    where: { id: orderId },
    data: {
      ticketEmailLastError: truncateError(message)
    }
  });
}

async function sendWithResend({
  to,
  subject,
  text,
  html
}: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    throw new TicketEmailConfigurationError();
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
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
}

export async function sendTicketDeliveryEmail({
  orderId,
  mode
}: {
  orderId: string;
  mode: DeliveryMode;
}) {
  const order = await loadTicketDeliveryOrder(orderId);

  if (order.status !== "paid") {
    throw new TicketEmailOrderStateError();
  }

  if (mode === "automatic" && order.ticketEmailSentAt) {
    return { skipped: true as const };
  }

  try {
    const recipient = order.user?.email;

    if (!recipient) {
      throw new TicketEmailRecipientError();
    }

    const email = renderTicketEmail(order);
    await sendWithResend({
      to: recipient,
      ...email
    });

    const now = new Date();
    await prisma.order.update({
      where: { id: order.id },
      data:
        mode === "automatic"
          ? {
              ticketEmailSentAt: now,
              ticketEmailLastError: null
            }
          : {
              ticketEmailResentAt: now,
              ticketEmailLastError: null
            }
    });

    return { skipped: false as const };
  } catch (error) {
    await recordTicketEmailFailure(order.id, error);
    throw error;
  }
}

export function isTicketEmailConfigurationError(error: unknown) {
  return error instanceof TicketEmailConfigurationError;
}

export function isTicketEmailRecipientError(error: unknown) {
  return error instanceof TicketEmailRecipientError;
}

export function isTicketEmailOrderStateError(error: unknown) {
  return error instanceof TicketEmailOrderStateError;
}
