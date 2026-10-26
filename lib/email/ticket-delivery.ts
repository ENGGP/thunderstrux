import { buyerIdentitySelect, retainedBuyerIdentity } from "@/lib/orders/buyer-identity";
import { purchaseLinkForEmail } from "@/lib/guest/guest-access";
import { purchasedTicketTypeLabel } from "@/lib/purchases/projection";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

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
  if (amountInCents === 0) return "Free";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD"
  }).format(amountInCents / 100);
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
      paymentKind: true,
      paidAt: true,
      ticketEmailSentAt: true,
      userId: true,
      guestIdentityId: true,
      purchasedTicketTypeName: true,
      sellerName: true,
      ...buyerIdentitySelect,
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
              name: true,
              timeZone: true
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
        where: { validity: "active" },
        select: {
          id: true
        },
        orderBy: { issueSequence: "asc" }
      }
    }
  });

  if (!order) {
    throw new TicketEmailError("Order not found");
  }

  return { ...order, user: retainedBuyerIdentity(order) };
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

// A guest's email also carries a link that opens this order (T16b).
export function renderTicketEmail(order: TicketDeliveryOrder, guestOrderLink?: string) {
  const name = buyerName(order);
  const greeting = name ? `Hi ${name},` : "Hi,";
  const ticketIds = order.tickets.map((ticket) => ticket.id);
  const ticketIdLines = ticketIds.map((id) => `- ${id}`).join("\n");
  const ticketIdHtml = ticketIds
    .map((id) => `<li><code>${escapeHtml(id)}</code></li>`)
    .join("");
  const subject = `Your tickets for ${order.event.title.replace(/[\r\n]+/g, " ")}`;
  // Purchase-time facts; the event date and place stay live.
  const ticketName = purchasedTicketTypeLabel(order.purchasedTicketTypeName, order.ticketType.name);
  const seller = order.sellerName ?? order.event.organisation.name;
  // In the society's zone, as event-change notices are (DEF-047).
  const date = formatDateTime(order.event.startTime, { timeZone: order.event.organisation.timeZone, dateStyle: "full" });
  // A free registration has no payment to confirm (DEF-050).
  const confirmed = order.paymentKind === "free" ? "Your registration is confirmed" : "Your payment is confirmed";

  const text = [
    greeting,
    "",
    `${confirmed} and your tickets for ${order.event.title} are ready.`,
    "",
    `Event: ${order.event.title}`,
    `Organiser: ${seller}`,
    `Date: ${date}`,
    `Location: ${order.event.location}`,
    `Ticket: ${ticketName}`,
    `Quantity: ${order.quantity}`,
    `Unit price: ${formatCurrency(order.unitPrice)}`,
    `Total: ${formatCurrency(order.totalAmount)}`,
    `Order ID: ${order.id}`,
    "",
    "Ticket IDs:",
    ticketIdLines || "- Not available",
    "",
    "QR scanning is not required for this MVP. Keep this email or your ticket IDs handy for the event.",
    ...(guestOrderLink ? ["", `Open your order (works once, for 24 hours; after that use Find your purchase): ${guestOrderLink}`] : [])
  ].join("\n");

  const html = `
    <div>
      <p>${escapeHtml(greeting)}</p>
      <p>${confirmed} and your tickets for <strong>${escapeHtml(
        order.event.title
      )}</strong> are ready.</p>
      <dl>
        <dt>Event</dt><dd>${escapeHtml(order.event.title)}</dd>
        <dt>Organiser</dt><dd>${escapeHtml(seller)}</dd>
        <dt>Date</dt><dd>${escapeHtml(date)}</dd>
        <dt>Location</dt><dd>${escapeHtml(order.event.location)}</dd>
        <dt>Ticket</dt><dd>${escapeHtml(ticketName)}</dd>
        <dt>Quantity</dt><dd>${order.quantity}</dd>
        <dt>Unit price</dt><dd>${escapeHtml(formatCurrency(order.unitPrice))}</dd>
        <dt>Total</dt><dd>${escapeHtml(formatCurrency(order.totalAmount))}</dd>
        <dt>Order ID</dt><dd><code>${escapeHtml(order.id)}</code></dd>
      </dl>
      <p><strong>Ticket IDs</strong></p>
      <ul>${ticketIdHtml || "<li>Not available</li>"}</ul>
      <p>QR scanning is not required for this MVP. Keep this email or your ticket IDs handy for the event.</p>
      ${guestOrderLink ? `<p><a href="${escapeHtml(guestOrderLink)}">Open your order</a> (works once, for 24 hours; after that use Find your purchase).</p>` : ""}
    </div>
  `;

  return { subject, text, html };
}

export async function sendWithResend({
  to,
  subject,
  text,
  html,
  idempotencyKey,
  from: frozenFrom,
  notification = false
}: {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey?: string;
  from?: string;
  notification?: boolean;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = frozenFrom ?? process.env.EMAIL_FROM;

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

  let endpoint = "https://api.resend.com/emails";
  if (notification && process.env.THUNDERSTRUX_MAIL_CAPTURE_URL) {
    if (!/^(baseline|browser|staging)-[a-f0-9]{24}$/.test(process.env.E2E_RUN_ID ?? "") ||
        process.env.THUNDERSTRUX_MAIL_CAPTURE_URL !== "http://mail-capture:8025/emails") {
      throw new TicketEmailConfigurationError("Mail capture requires an isolated E2E run");
    }
    endpoint = process.env.THUNDERSTRUX_MAIL_CAPTURE_URL;
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(15000),
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
    idempotencyKey,
    attempt = 0
  }: {
    idempotencyKey?: string;
    attempt?: number;
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

  // A guest's link is minted per send attempt, so no raw link is stored.
  // shortcut: a retry carries a new link, so its provider key includes the attempt and a lost response can mean a second email; move the link to an encrypted notification if duplicates matter.
  const guestOrderLink = order.guestIdentityId && !order.userId ? await purchaseLinkForEmail(order.id, order.guestIdentityId) : undefined;
  const email = renderTicketEmail(order, guestOrderLink);
  const delivery = await sendWithResend({
    to: recipient,
    idempotencyKey: guestOrderLink && idempotencyKey ? `${idempotencyKey}/${attempt}` : idempotencyKey,
    ...email
  });

  return { order, providerMessageId: delivery.providerMessageId };
}
