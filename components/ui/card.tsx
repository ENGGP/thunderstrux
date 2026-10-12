import type { ReactNode } from "react";

export function Card({
  children,
  className = ""
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-card border border-line bg-surface p-5 sm:p-6 ${className}`}
    >
      {children}
    </section>
  );
}
