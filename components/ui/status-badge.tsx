import { Icon, type IconName } from "./icon";

const tones = {
  neutral: { box: "border-neutral-border bg-neutral-bg text-neutral", icon: "text-neutral-icon" },
  success: { box: "border-success-border bg-success-bg text-success", icon: "text-success-icon" },
  warning: { box: "border-warning-border bg-warning-bg text-warning", icon: "text-warning-icon" },
  danger: { box: "border-danger-border bg-danger-bg text-danger", icon: "text-danger-icon" },
  // Selected lilac: something that is yours (joined, upcoming).
  accent: { box: "border-brand-200 bg-brand-tint text-brand-hover", icon: "text-brand" },
  // White with a brand edge: your turn to act (ready to collect).
  outline: { box: "border-brand bg-surface text-brand-hover", icon: "text-brand" }
};

// One mapping from a server status to its word, colour and glyph. The word always
// carries the meaning; the glyph tells the families apart without colour (a tick
// is never mistaken for a cross under colour blindness), and colour only supports
// both. Green means money moved or someone admitted; a draft is a normal state,
// not a warning; a joined society is a relationship, not a success.
const statuses = {
  draft: ["Draft", "neutral", "circle"],
  published: ["Published", "neutral", "circle"],
  pending: ["Pending", "warning", "clock"],
  processing: ["Processing", "warning", "clock"],
  paid: ["Paid", "success", "success"],
  free: ["Free", "neutral", "circle"],
  review: ["Payment review", "warning", "warning"],
  refunded: ["Refunded", "neutral", "return"],
  "refunded-outside": ["Refunded outside Thunderstrux", "neutral", "return"],
  "refund-processing": ["Refund processing", "warning", "clock"],
  disputed: ["Disputed", "warning", "warning"],
  cancelled: ["Cancelled", "neutral", "dash"],
  // An event the society called off: crimson, so a shared link can't read as on, and
  // the one word every view uses for it.
  "event-cancelled": ["Cancelled", "danger", "error"],
  failed: ["Failed", "danger", "error"],
  expired: ["Expired", "neutral", "dash"],
  joined: ["Joined", "accent", "yours"],
  // A membership held now. Staff access uses staff-active, so green stays for members.
  active: ["Active", "success", "success"],
  "staff-active": ["Active", "neutral", "circle"],
  upcoming: ["Upcoming", "accent", "yours"],
  revoked: ["Revoked", "neutral", "dash"],
  accepted: ["Accepted", "success", "success"],
  // Ready, not money: email verified, Stripe payouts set up.
  ready: ["Ready", "neutral", "circle"],
  "checked-in": ["Checked in", "success", "success"],
  valid: ["Valid", "success", "success"],
  "under-review": ["Under review", "warning", "warning"],
  void: ["Void", "neutral", "dash"],
  unused: ["Unused", "neutral", "circle"],
  "sales-open": ["Sales open", "success", "success"],
  "sales-closed": ["Sales closed", "neutral", "dash"],
  "sold-out": ["Sold out", "neutral", "dash"],
  // Membership plans (T22): published but past their last day, or withdrawn.
  ended: ["Ended", "neutral", "dash"],
  archived: ["Archived", "neutral", "dash"],
  // Merchandise pickup (T28a), always a separate badge from payment.
  preparing: ["Preparing", "neutral", "circle"],
  "ready-to-collect": ["Ready to collect", "outline", "bag"],
  collected: ["Collected", "success", "success"],
  // Pickup states the Orders tab shows when there is nothing to hand over.
  "on-hold": ["On hold", "warning", "warning"],
  "not-collected": ["Not collected", "neutral", "dash"],
  "no-pickup": ["No pickup", "neutral", "dash"]
} as const satisfies Record<string, readonly [string, keyof typeof tones, IconName]>;

export type Status = keyof typeof statuses;

// The word alone, for text that isn't a badge (spreadsheet exports, UI-018).
export const statusLabel = (status: Status) => statuses[status][0];

export function StatusBadge({
  status,
  label
}: {
  status: Status;
  label?: string;
}) {
  const [text, tone, glyph] = statuses[status];

  return (
    <span
      className={`inline-flex h-6 w-fit items-center gap-1.5 whitespace-nowrap rounded-tag border pl-1.5 pr-2 text-xs font-semibold ${tones[tone].box}`}
    >
      <Icon className={tones[tone].icon} name={glyph} size={14} />
      {label ?? text}
    </span>
  );
}
