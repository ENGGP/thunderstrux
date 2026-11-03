import Link from "next/link";
import type { ReactNode } from "react";
import { quietLinkClasses } from "@/components/ui/link-tabs";

// A ticket purchase's steps, the same on every page it passes through (DEBT-002).
export function ticketSteps({ guest, free }: { guest: boolean; free: boolean }) {
  if (guest) return free ? ["Your email", "Confirm", "Tickets"] : ["Your email", "Review", "Pay with Stripe", "Tickets"];
  return free ? ["Review", "Tickets"] : ["Review", "Pay with Stripe", "Tickets"];
}

// The narrow frame every purchase step shares: who the booking is with, the
// way back, the step the buyer is on, then the step's content and its summary.
// A settled order passes no steps: it's a receipt, not a checkout in progress.
export function CheckoutShell({
  society,
  lead = "Booking for",
  backHref,
  backLabel = "Change tickets",
  title,
  steps = [],
  current = 0,
  context,
  aside,
  children
}: {
  society: string;
  // Tickets are booked; memberships and merchandise are bought.
  lead?: "Booking for" | "Buying from" | "Bought from";
  backHref?: string;
  backLabel?: string;
  title: string;
  steps?: string[];
  current?: number;
  // What is being bought, in one line, for phones, where the summary card comes after the form.
  context?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main id="main" tabIndex={-1} className="min-h-screen bg-paper">
      <div className="mx-auto grid max-w-checkout gap-6 px-4 py-8 sm:px-6 lg:py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-ink-soft [overflow-wrap:anywhere]">{lead} {society}</p>
          {backHref ? (
            <Link className={`inline-flex min-h-11 items-center text-sm ${quietLinkClasses}`} href={backHref}>
              {backLabel}
            </Link>
          ) : null}
        </div>
        <div className="grid gap-3">
          <h1 className="font-display text-3xl font-semibold text-ink">{title}</h1>
          {steps.length ? (
            <ol aria-label="Steps" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {steps.map((step, index) => (
                <li
                  aria-current={index === current ? "step" : undefined}
                  className={`whitespace-nowrap ${index === current ? "font-semibold text-brand-ink" : "text-ink-muted"}`}
                  key={step}
                >
                  {index + 1}. {step}
                </li>
              ))}
            </ol>
          ) : null}
          {context ? <p className="text-ui text-ink-soft [overflow-wrap:anywhere] lg:hidden">{context}</p> : null}
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="grid gap-6">{children}</div>
          {aside ? <aside className="grid gap-4 lg:sticky lg:top-24">{aside}</aside> : null}
        </div>
      </div>
    </main>
  );
}
