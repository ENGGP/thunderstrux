"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Whether the page's own action is below the screen, so a phone bar can repeat it.
// Attach the ref to the wrapper of that action.
export function useActionBelow<T extends Element>() {
  const ref = useRef<T>(null);
  const [below, setBelow] = useState(false);
  useEffect(() => {
    const target = ref.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setBelow(!entry.isIntersecting && entry.boundingClientRect.top > 0));
    observer.observe(target);
    return () => observer.disconnect();
  });
  return [ref, below] as const;
}

// Below lg, a bottom bar that repeats the summary and the action while the page's
// own button is still below the screen (the event buy box and every checkout).
// It stays mounted and slides, so a scroll reversal mid-slide retargets; while
// hidden it is invisible and inert, so it is never read or tabbed to twice.
export function PhoneActionBar({ show, summary, children }: { show: boolean; summary: ReactNode; children: ReactNode }) {
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-float transition-[translate,visibility] duration-240 ease-drawer lg:hidden ${show ? "visible translate-y-0" : "invisible translate-y-full"}`}
      inert={!show}
    >
      <p className="grid min-w-0 flex-1">{summary}</p>
      {children}
    </div>
  );
}

// Back from Stripe, the browser can restore this page as it was left, button busy
// and all: reset it so the buyer isn't stuck on a disabled "Opening Stripe…".
export function useResetOnRestore(reset: () => void) {
  const latest = useRef(reset);
  latest.current = reset;
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) latest.current();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
}
