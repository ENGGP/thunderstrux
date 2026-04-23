import type { ReactNode } from "react";

export function Card({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      {children}
    </section>
  );
}
