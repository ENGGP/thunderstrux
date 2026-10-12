const tones = {
  neutral: "bg-surface-subtle text-ink-soft",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info"
};

// One mapping from a server status to its words and colour. The word always
// carries the meaning; colour only supports it.
const statuses = {
  draft: ["Draft", "warning"],
  published: ["Published", "success"],
  pending: ["Pending", "warning"],
  paid: ["Paid", "success"],
  failed: ["Failed", "danger"],
  expired: ["Expired", "neutral"],
  joined: ["Joined", "success"],
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
      className={`inline-flex items-center rounded-tag px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}
    >
      {label ?? text}
    </span>
  );
}
