import type { ButtonHTMLAttributes } from "react";

type ButtonStyle = {
  variant?: "primary" | "secondary" | "tertiary" | "danger" | "dangerSolid";
  size?: "sm" | "md" | "lg";
  className?: string;
  // Working on a request: keeps its colour and shows progress, not the neutral "unavailable" look.
  busy?: boolean;
};

// Every variant carries a border (transparent where none shows), so turning
// disabled or busy never adds one and the button never changes width.
const variants = {
  primary: "border border-transparent bg-brand text-white hover:bg-brand-hover active:bg-brand-ink",
  secondary:
    "border border-line-strong bg-surface text-brand-ink hover:bg-brand-tint",
  tertiary: "border border-transparent text-brand underline-offset-4 hover:underline",
  danger: "border border-danger bg-surface text-danger hover:bg-danger-bg",
  // Solid danger appears only on the confirming button of a dialog.
  dangerSolid: "border border-transparent bg-danger text-white hover:opacity-90"
};

const sizes = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-5 text-base"
};

// Shared by <Button> and by links that must look like buttons. A disabled
// button turns neutral so it never reads as a faded primary action; a busy one
// keeps its colour, because it is working, not unavailable.
export function buttonClasses({
  variant = "primary",
  size = "md",
  className = "",
  busy = false
}: ButtonStyle = {}) {
  const inactive = busy
    ? "cursor-progress"
    : "disabled:cursor-not-allowed disabled:border-neutral-border disabled:bg-neutral-bg disabled:text-ink-muted disabled:no-underline";
  return `inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-[color,background-color,border-color,opacity,scale] duration-150 ease-out active:not-disabled:scale-97 ${inactive} ${sizes[size]} ${variants[variant]} ${className}`;
}

// With `busyLabel`, the label and the busy label (drawn by ::after, so it is never
// part of the button's text) share one grid cell, and whichever isn't showing is
// `invisible`. The button is always as wide as the longer of the two, so pressing
// it never moves anything beside it, and its name is whichever label shows.
export function Button({
  className,
  variant,
  size,
  busy = false,
  busyLabel,
  disabled,
  children,
  ...props
}: ButtonStyle & { busyLabel?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      aria-busy={busy || undefined}
      className={buttonClasses({ variant, size, className, busy })}
      disabled={disabled || busy}
      {...props}
    >
      {busyLabel === undefined ? (
        children
      ) : (
        <span
          className={`grid justify-items-center after:col-start-1 after:row-start-1 after:content-[attr(data-busy-label)] ${busy ? "" : "after:invisible"}`}
          data-busy-label={busyLabel}
        >
          <span className={`col-start-1 row-start-1 ${busy ? "invisible" : ""}`}>{children}</span>
        </span>
      )}
    </button>
  );
}
