import Link from "next/link";
import type { ReactNode } from "react";

// The narrow frame every purchase step shares: who the booking is with, the
// way back, the step the buyer is on, then the step's content and its summary.
export function CheckoutShell({
  society,
  backHref,
  backLabel = "Change tickets",
  title,
  steps,
  current,
  aside,
  children
}: {
  society: string;
  backHref?: string;
  backLabel?: string;
  title: string;
  steps: string[];
  current: number;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main id="main" tabIndex={-1} className="min-h-screen bg-paper">
      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-6 lg:py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-ink-soft [overflow-wrap:anywhere]">Booking for {society}</p>
          {backHref ? (
            <Link className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4" href={backHref}>
              {backLabel}
            </Link>
          ) : null}
        </div>
        <div className="grid gap-3">
          <h1 className="font-display text-3xl font-semibold text-ink">{title}</h1>
          <ol aria-label="Steps" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {steps.map((step, index) => (
              <li
                aria-current={index === current ? "step" : undefined}
                className={index === current ? "font-semibold text-brand-ink" : "text-ink-muted"}
                key={step}
              >
                {index + 1}. {step}
              </li>
            ))}
          </ol>
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="grid gap-6">{children}</div>
          {aside ? <aside className="grid gap-4 lg:sticky lg:top-24">{aside}</aside> : null}
        </div>
      </div>
    </main>
  );
}
