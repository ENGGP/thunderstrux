"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";

// T54 (board H3): paste an id, an email or a name; Enter searches, and one match
// opens its record. "/" or Ctrl/⌘+K focuses it from anywhere. Recent records live in
// this tab's sessionStorage only (ids and display names, never emails) and go when it closes.
const recentKey = "thunderstrux-admin-recent";
type Recent = { kind: string; label: string; href: string };

export function readRecent(): Recent[] {
  try {
    const rows = JSON.parse(sessionStorage.getItem(recentKey) ?? "[]");
    return Array.isArray(rows) ? rows.slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function RememberRecord(record: Recent) {
  const { kind, label, href } = record;
  useEffect(() => {
    try {
      const rows = [{ kind, label, href }, ...readRecent().filter((row) => row.href !== href)].slice(0, 8);
      sessionStorage.setItem(recentKey, JSON.stringify(rows));
    } catch {
      // Storage off (a private window): the list just stays empty.
    }
  }, [kind, label, href]);
  return null;
}

export function Omnibox() {
  const input = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable='true']");
      if ((event.key === "/" && !typing) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form action="/admin/search" className="relative flex max-w-[620px] flex-[1_1_360px] items-center" method="get" role="search">
      <label className="sr-only" htmlFor="admin-omnibox">Search or paste an id</label>
      <Icon className="pointer-events-none absolute left-2.5 text-ink-muted" name="search" size={18} />
      <input
        autoComplete="off"
        className="h-[38px] w-full rounded-[8px] border border-line-strong bg-[#f9f8fb] pl-9 pr-12 text-sm font-medium text-ink focus:bg-surface"
        id="admin-omnibox"
        name="q"
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => { setRecent(readRecent()); setOpen(true); }}
        onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.blur(); }}
        placeholder="Search or paste an id: email, cs_…, acct_…, order reference"
        ref={input}
        type="search"
      />
      <kbd aria-hidden="true" className="pointer-events-none absolute right-2 rounded-[5px] border border-b-2 border-line-strong bg-surface px-1.5 font-mono text-[11.5px] font-semibold text-ink-soft">/</kbd>
      {open && recent.length > 0 ? (
        <div className="absolute left-0 right-0 top-[44px] z-20 rounded-[10px] border border-line bg-surface p-1.5 shadow-[var(--shadow-float)]">
          <p className="px-2.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-ink-muted">Recent</p>
          <ul aria-label="Recently opened">
            {recent.map((row) => (
              <li key={row.href}>
                <a className="grid min-h-9 grid-cols-[84px_minmax(0,1fr)] items-center gap-3 rounded-[7px] px-2.5 hover:bg-surface-subtle" href={row.href}>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{row.kind}</span>
                  <span className="truncate font-semibold">{row.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
