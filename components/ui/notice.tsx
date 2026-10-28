import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

// The wash, hairline and icon carry the tone; the icon and title name it, so
// the meaning never depends on colour alone.
const tones: Record<string, { box: string; heading: string; icon: string; name: IconName }> = {
  info: { box: "border-info-border bg-info-bg", heading: "text-ink", icon: "text-info-icon", name: "info" },
  success: { box: "border-success-border bg-success-bg", heading: "text-success", icon: "text-success-icon", name: "success" },
  warning: { box: "border-warning-border bg-warning-bg", heading: "text-warning", icon: "text-warning-icon", name: "warning" },
  danger: { box: "border-danger-border bg-danger-bg", heading: "text-danger", icon: "text-danger-icon", name: "error" }
};

// Give it role="alert" or role="status" only when it reports the result of an
// action; guidance that is always on the page needs no live region.
export function Notice({
  tone = "info",
  title,
  role,
  className = "",
  onDismiss,
  action,
  reveal = false,
  children
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: string;
  role?: "alert" | "status";
  className?: string;
  // A result that appears after an action: it opens smoothly where it lands
  // (animate-reveal) instead of pushing what's below in one jump.
  reveal?: boolean;
  // A link or button that resolves the message, shown at the end of the row.
  action?: ReactNode;
  // Only from client components; dismissing hides the message, it never resolves it.
  onDismiss?: () => void;
  children: ReactNode;
}) {
  const style = tones[tone];

  const box = (
    <div
      className={`flex items-start gap-3 rounded-card border px-4 py-3 text-sm ${style.box} ${reveal ? "" : className}`}
      role={role}
    >
      <Icon className={`mt-px ${style.icon}`} name={style.name} size={20} />
      <div className={`min-w-0 flex-1 ${title ? "text-ink-soft" : `font-medium ${style.heading}`}`}>
        {title ? <p className={`text-ui font-semibold ${style.heading}`}>{title}</p> : null}
        {children}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
      {onDismiss ? (
        <button
          aria-label="Dismiss"
          className="-my-2 -mr-2 inline-flex size-10 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-surface hover:text-ink"
          onClick={onDismiss}
          type="button"
        >
          <Icon name="close" size={16} />
        </button>
      ) : null}
    </div>
  );

  if (!reveal) return box;
  // The row animates from 0fr; clipping (not hiding) keeps a focus ring visible inside it.
  return (
    <div className={`grid animate-reveal grid-rows-[1fr] ${className}`}>
      <div className="min-h-0 overflow-clip [overflow-clip-margin:4px]">{box}</div>
    </div>
  );
}
