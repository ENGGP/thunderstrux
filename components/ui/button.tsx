import type { ButtonHTMLAttributes } from "react";

type ButtonStyle = {
  variant?: "primary" | "secondary" | "tertiary" | "danger" | "dangerSolid";
  size?: "sm" | "md" | "lg";
  className?: string;
};

const variants = {
  primary: "bg-brand text-white hover:bg-brand-hover active:bg-brand-ink",
  secondary:
    "border border-line-strong bg-surface text-brand-ink hover:bg-brand-tint",
  tertiary: "text-brand underline-offset-4 hover:underline",
  danger: "border border-danger bg-surface text-danger hover:bg-danger-bg",
  // Solid danger appears only on the confirming button of a dialog.
  dangerSolid: "bg-danger text-white hover:opacity-90"
};

const sizes = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-5 text-base"
};

// Shared by <Button> and by links that must look like buttons. A disabled
// button turns neutral so it never reads as a faded primary action.
export function buttonClasses({
  variant = "primary",
  size = "md",
  className = ""
}: ButtonStyle = {}) {
  return `inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:border disabled:border-neutral-border disabled:bg-neutral-bg disabled:text-ink-muted disabled:no-underline ${sizes[size]} ${variants[variant]} ${className}`;
}

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonStyle & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={buttonClasses({ variant, size, className })} {...props} />
  );
}
