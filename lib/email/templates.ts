import { z } from "zod";

export const notificationTemplateSchema = z.enum([
  "verify_account", "reset_password", "password_changed", "email_change_requested",
  "email_changed", "account_closed", "business_notice"
]);
export type NotificationTemplate = z.infer<typeof notificationTemplateSchema>;
export const notificationPayloadSchema = z.object({
  message: z.string().min(1).max(2000),
  link: z.string().url().max(2000).optional()
}).strict();
export const renderedNotificationSchema = z.object({
  subject: z.string().max(200), text: z.string().max(10000), html: z.string().max(15000),
  from: z.string().min(1).max(320)
}).strict();

const subjects: Record<NotificationTemplate, string> = {
  verify_account: "Verify your Thunderstrux email", reset_password: "Reset your Thunderstrux password",
  password_changed: "Your Thunderstrux password changed", email_change_requested: "Thunderstrux email change requested",
  email_changed: "Your Thunderstrux email changed", account_closed: "Your Thunderstrux account is closed",
  business_notice: "Thunderstrux notification"
};
export function escapeEmailHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function renderNotification(template: NotificationTemplate, input: unknown) {
  const payload = notificationPayloadSchema.parse(input);
  if (payload.link) {
    const link = new URL(payload.link);
    const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "");
    if (link.origin !== origin.origin || link.username || link.password ||
        (link.protocol !== "https:" && !(link.protocol === "http:" && ["localhost", "127.0.0.1"].includes(link.hostname)))) {
      throw new Error("Notification link must use the configured first-party origin");
    }
  }
  return {
    subject: subjects[template],
    text: `${payload.message}${payload.link ? `\n\n${payload.link}` : ""}`,
    html: `<p>${escapeEmailHtml(payload.message)}</p>${payload.link ? `<p><a href="${escapeEmailHtml(payload.link)}">Continue</a></p>` : ""}`
  };
}
