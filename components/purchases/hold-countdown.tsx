"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const left = (endsAt: number) => Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));

// The time left on a checkout hold (PAY-009), as Humanitix shows at checkout:
// "12:34 left", then "Your hold has ended" and a refresh that shows what happened.
// The ticking digits are hidden from screen readers; a minute-by-minute line is announced instead.
export function HoldCountdown({ endsAt }: { endsAt: string }) {
  const router = useRouter();
  const end = new Date(endsAt).getTime();
  // Rendered on the server too, so the first paint has a value (no shift); the
  // client's first tick may differ by a second, which suppressHydrationWarning allows.
  const [seconds, setSeconds] = useState(() => left(end));

  useEffect(() => {
    const timer = setInterval(() => {
      const next = left(end);
      setSeconds(next);
      if (next === 0) {
        clearInterval(timer);
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [end, router]);

  if (seconds === 0) return <span className="font-semibold text-ink" role="status">Your hold has ended.</span>;
  const minutes = Math.ceil(seconds / 60);
  return (
    <span className="font-semibold text-ink">
      {/* Always mm:ss in tabular digits, so the text never changes width as it ticks. */}
      <span aria-hidden="true" className="tabular-nums" suppressHydrationWarning>
        {String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}
      </span>
      <span aria-hidden="true"> left.</span>
      <span aria-live="polite" className="sr-only" suppressHydrationWarning>{minutes === 1 ? "About a minute left." : `About ${minutes} minutes left.`}</span>
    </span>
  );
}
