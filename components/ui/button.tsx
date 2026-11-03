import type { ButtonHTMLAttributes } from "react";

type ButtonStyle = {
  variant?: "primary" | "secondary" | "subtle" | "tertiary" | "onNight" | "ghostNight" | "quiet" | "danger" | "dangerText" | "dangerSolid";
  size?: "sm" | "md" | "lg";
  className?: string;
  // Working on a request: keeps its colour and shows progress, not the neutral "unavailable" look.
  busy?: boolean;
};

// Every variant carries a border (transparent where none shows), so turning
// disabled or busy never adds one and the button never changes width.
const variants = {
  primary: "border border-transparent bg-brand text-on-brand hover:bg-brand-hover active:bg-night",
  // Lilac means "chosen", so a hovered secondary button takes the inset tone instead.
  secondary:
    "border border-line-strong bg-surface text-brand-ink hover:bg-surface-subtle",
  // A violet outline for an action repeated down a list or a header on phones, so the screen keeps
  // one filled violet button. Never the lilac fill: lilac means "you chose this".
  subtle: "border border-subtle-edge bg-surface text-brand-hover hover:bg-surface-subtle",
  tertiary: "border border-transparent text-brand underline-offset-4 hover:underline",
  // On a night violet surface: the white primary, and a glow-edged ghost beside it.
  onNight: "border border-transparent bg-surface text-night hover:bg-surface-subtle",
  ghostNight: "border border-glow text-white hover:bg-night-raised",
  // Cancel and other ways out: present, but never competing with the one action that does something.
  quiet: "border border-transparent text-ink-soft underline-offset-4 hover:text-ink hover:underline",
  danger: "border border-danger bg-surface text-danger hover:bg-danger-bg",
  // A destructive action in a list: crimson words, so a column of them isn't a wall of red. Its dialog confirms in solid crimson.
  dangerText: "border border-transparent text-danger underline-offset-4 hover:underline",
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
