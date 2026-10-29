"use client";

import { useId, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";

// Below md a filter form folds behind a Filters toggle that says how many are on,
// open while any is (UI-004, as Explore events does). From md the fields always
// show; `contents` keeps them items of the form's own grid either way.
export function FilterFold({ active, children }: { active: number; children: ReactNode }) {
  const [open, setOpen] = useState(active > 0);
  const id = useId();

  return (
    <>
      <button
        aria-controls={id}
        aria-expanded={open}
        className="col-span-full flex min-h-12 items-center justify-between rounded-control border border-line bg-surface px-3.5 text-sm font-semibold text-ink md:hidden"
        onClick={() => setOpen(!open)}
        type="button"
      >
        Filters
        <span className="flex items-center gap-2">
          {active ? <span className="rounded-tag bg-brand-tint px-2 py-0.5 text-xs text-brand-ink">{active} on</span> : null}
          <Icon className={open ? "rotate-180" : ""} name="chevronDown" />
        </span>
      </button>
      <div className={`${open ? "contents" : "hidden"} md:contents`} id={id}>
        {children}
      </div>
    </>
  );
}
