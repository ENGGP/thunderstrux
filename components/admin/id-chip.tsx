"use client";

import { useState } from "react";

// T54: ids are shown whole in monospace with Copy, so a developer can take one
// to the logs, Stripe or the database without retyping it.
export function IdChip({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex h-[26px] items-center whitespace-nowrap rounded-[6px] border border-line bg-[#f9f8fb] pl-2 font-mono text-[12.5px] font-medium text-ink">
      {value}
      <button
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        className="ml-0.5 inline-flex h-6 w-7 items-center justify-center rounded-r-[5px] border-l border-line text-ink-soft hover:text-ink"
        onClick={async () => {
          await navigator.clipboard?.writeText(value).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        type="button"
      >
        <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="14">
          {copied ? <path d="m5 12.5 4.5 4.5L19 7.5" /> : <path d="M9 9h10v11H9zM5 15V4h11" />}
        </svg>
      </button>
    </span>
  );
}
