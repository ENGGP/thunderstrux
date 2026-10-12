import type { ReactNode } from "react";

const tones = {
  info: "border-info bg-info-bg text-info",
  success: "border-success bg-success-bg text-success",
  warning: "border-warning bg-warning-bg text-warning",
  danger: "border-danger bg-danger-bg text-danger"
};

// Give it role="alert" or role="status" only when it reports the result of an
// action; guidance that is always on the page needs no live region.
export function Notice({
  tone = "info",
  title,
  role,
  className = "",
  children
}: {
  tone?: keyof typeof tones;
  title?: string;
  role?: "alert" | "status";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-control border-l-[3px] px-4 py-3 text-sm ${tones[tone]} ${className}`}
      role={role}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children}
    </div>
  );
}
