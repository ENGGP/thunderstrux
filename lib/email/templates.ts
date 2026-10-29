import { z } from "zod";
import { appUrl } from "@/lib/app-url";

export const notificationTemplateSchema = z.enum([
  "verify_account", "reset_password", "password_changed", "email_change_requested",
  "email_changed", "account_closed", "staff_invite", "business_notice", "guest_access", "guest_order_link", "event_cancelled",
  "society_enquiry"
]);
// Society notices: tenant-owned, listed and requeued on the society's Notifications page.
export const businessTemplates: readonly NotificationTemplate[] = ["business_notice", "event_cancelled", "society_enquiry"];
export type NotificationTemplate = z.infer<typeof notificationTemplateSchema>;
export const notificationPayloadSchema = z.object({
  message: z.string().min(1).max(2000),
  link: z.string().url().max(2000).optional(),
  // A society notice can name its own subject (T30), such as the event that changed. Organiser
  // text may hold line breaks; they fold to a space so one name can't fail a whole fan-out (SEC-003).
  subject: z.preprocess((value) => (typeof value === "string" ? value.replace(/[\r\n]+/g, " ") : value), z.string().trim().min(1).max(200)).optional(),
  // Only an enquiry is answered by replying, straight to whoever wrote it.
  replyTo: z.string().trim().toLowerCase().email().max(320).optional()
}).strict();
export const renderedNotificationSchema = z.object({
  subject: z.string().max(200), text: z.string().max(10000), html: z.string().max(15000),
  from: z.string().min(1).max(320), replyTo: z.string().email().max(320).optional()
}).strict();

const subjects: Record<NotificationTemplate, string> = {
  verify_account: "Verify your Thunderstrux email", reset_password: "Reset your Thunderstrux password",
  password_changed: "Your Thunderstrux password changed", email_change_requested: "Thunderstrux email change requested",
  email_changed: "Your Thunderstrux email changed", account_closed: "Your Thunderstrux account is closed",
  staff_invite: "Your Thunderstrux staff invitation",
  business_notice: "Thunderstrux notification",
  guest_access: "Confirm your email to continue your order",
  guest_order_link: "Your Thunderstrux order",
  // EVT-004: one per ticket holder when a society cancels an event; the subject names the event.
  event_cancelled: "Event cancelled",
  // DEBT-002: "Contact {society}", sent to the society; the subject names the event and sender.
  society_enquiry: "Enquiry"
};
export function escapeEmailHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function renderNotification(template: NotificationTemplate, input: unknown) {
  const payload = notificationPayloadSchema.parse(input);
  if (payload.replyTo && template !== "society_enquiry") throw new Error("Only an enquiry has a reply-to address");
  if (payload.link) {
    const link = new URL(payload.link);
    const origin = new URL(appUrl() ?? "");
    if (link.origin !== origin.origin || link.username || link.password ||
        (link.protocol !== "https:" && !(link.protocol === "http:" && ["localhost", "127.0.0.1"].includes(link.hostname)))) {
      throw new Error("Notification link must use the configured first-party origin");
    }
  }
  return {
    subject: (businessTemplates.includes(template) && payload.subject) || subjects[template],
    text: `${payload.message}${payload.link ? `\n\n${payload.link}` : ""}`,
    // A buyer's own words keep their line breaks.
    html: `<p${template === "society_enquiry" ? ` style="white-space:pre-wrap"` : ""}>${escapeEmailHtml(payload.message)}</p>${payload.link ? `<p><a href="${escapeEmailHtml(payload.link)}">Continue</a></p>` : ""}`,
    ...(payload.replyTo ? { replyTo: payload.replyTo } : {})
  };
}
