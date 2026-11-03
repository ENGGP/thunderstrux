"use client";

import { useEffect, useState } from "react";

type DoorTheme = "system" | "light" | "dark";
const key = "thunderstrux:door-theme";
const choices: Array<[DoorTheme, string]> = [["system", "Auto"], ["light", "Light"], ["dark", "Dark"]];

// The door's own light or dark look (round G). The server renders "system", so the
// stylesheet follows the phone's setting with no script and no flash; Light or Dark
// is remembered on this device until Auto is chosen again. Only the door page
// carries the attribute, so the rest of the app stays light.
export function DoorThemeSwitch() {
  const [theme, setTheme] = useState<DoorTheme>("system");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {
      // Storage can be blocked (private windows); Auto still follows the phone.
    }
  }, []);

  function choose(next: DoorTheme) {
    setTheme(next);
    try {
      if (next === "system") localStorage.removeItem(key);
      else localStorage.setItem(key, next);
    } catch {
      // Not remembered, but the choice still applies until the page is left.
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-door-theme={theme}>
      <span className="text-sm text-ink-soft" id="door-theme-label">Theme</span>
      <div aria-labelledby="door-theme-label" className="inline-flex gap-1 rounded-control border border-line bg-surface p-1" role="group">
        {choices.map(([value, label]) => (
          <button
            aria-pressed={theme === value}
            className={`min-h-11 rounded-[7px] px-3.5 text-sm font-semibold ${theme === value ? "bg-brand-tint text-ink shadow-[inset_0_0_0_1px_var(--color-brand)]" : "text-ink-soft hover:text-ink"}`}
            key={value}
            onClick={() => choose(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
