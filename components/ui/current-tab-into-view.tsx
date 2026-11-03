"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

// A tab bar that scrolls sideways (tab-cue) keeps its current tab in view: when the
// page loads or the current tab changes, a tab off either edge is brought to the
// middle of its bar. A tab already in view is left alone, and it moves instantly,
// so it never fights the reader's own scrolling or reduced motion.
export function CurrentTabIntoView() {
  const pathname = usePathname();
  useEffect(() => {
    const centre = () => {
      for (const bar of document.querySelectorAll<HTMLElement>(".tab-cue")) {
        const current = bar.querySelector<HTMLElement>('[aria-current="page"]');
        if (!current || bar.scrollWidth <= bar.clientWidth) continue;
        const box = bar.getBoundingClientRect();
        const tab = current.getBoundingClientRect();
        if (tab.left >= box.left && tab.right <= box.right) continue;
        bar.scrollLeft += tab.left - box.left - (box.width - tab.width) / 2;
      }
    };
    centre();
    // Query-string tabs change aria-current without a new path.
    const observer = new MutationObserver(centre);
    observer.observe(document.body, { subtree: true, attributeFilter: ["aria-current"] });
    return () => observer.disconnect();
  }, [pathname]);
  return null;
}
