const tones = {
  neutral: { box: "border-neutral-border bg-neutral-bg text-neutral", dot: "bg-neutral-icon" },
  success: { box: "border-success-border bg-success-bg text-success", dot: "bg-success-icon" },
  warning: { box: "border-warning-border bg-warning-bg text-warning", dot: "bg-warning-icon" },
  danger: { box: "border-danger-border bg-danger-bg text-danger", dot: "bg-danger-icon" },
  accent: { box: "border-brand-200 bg-brand-tint text-brand-hover", dot: "bg-brand" }
};

// One mapping from a server status to its words and colour. The word always
// carries the meaning; colour only supports it. A draft is a normal state, not
// a warning, and a joined society is a relationship, not a success.
const statuses = {
  draft: ["Draft", "neutral"],
  published: ["Published", "success"],
  pending: ["Pending", "warning"],
  paid: ["Paid", "success"],
  failed: ["Failed", "danger"],
  expired: ["Expired", "neutral"],
  joined: ["Joined", "accent"],
  active: ["Active", "success"],
  revoked: ["Revoked", "neutral"],
  accepted: ["Accepted", "success"],
  "checked-in": ["Checked in", "success"],
  unused: ["Unused", "neutral"]
} as const satisfies Record<string, readonly [string, keyof typeof tones]>;

export type Status = keyof typeof statuses;

export function StatusBadge({
  status,
  label
}: {
  status: Status;
  label?: string;
}) {
  const [text, tone] = statuses[status];

  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-tag border px-2 text-xs font-semibold ${tones[tone].box}`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${tones[tone].dot}`} />
      {label ?? text}
    </span>
  );
}
