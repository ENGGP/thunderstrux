import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "society";
};

export function Button({
  className = "",
  variant = "primary",
  ...props
}: ButtonProps) {
  const variantClasses =
    variant === "society" ? "society-action" : variant === "primary"
      ? "bg-neutral-900 text-white hover:bg-neutral-700"
      : "border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50";

  return (
    <button
      className={`inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${variantClasses} ${className}`}
      {...props}
    />
  );
}
