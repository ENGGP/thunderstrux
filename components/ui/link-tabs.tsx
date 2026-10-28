import Link from "next/link";

// URL-driven tabs: each tab is a link, so the view survives reloads and can be
// shared. The bar scrolls sideways on narrow screens instead of wrapping.
export const tabBarClasses =
  "flex overflow-x-auto shadow-[inset_0_-1px_0_var(--color-line)] sm:gap-1";

export function tabClasses(active: boolean) {
  return `inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-[3px] px-3 text-ui sm:px-4 ${
    active
      ? "border-brand font-semibold text-brand-ink"
      : "border-transparent font-medium text-ink-soft hover:text-ink"
  }`;
}

// The active tab is semibold, the rest medium. A hidden semibold copy (::after,
// so it is in neither the text nor the name) reserves the wider width, so
// changing tab never nudges the labels beside it.
export function TabLabel({ children }: { children: string }) {
  return (
    <span
      className="inline-flex flex-col after:invisible after:h-0 after:overflow-hidden after:font-semibold after:content-[attr(data-label)]"
      data-label={children}
    >
      {children}
    </span>
  );
}

// Status filters inside a tab (artboard OrdersB2): pills, so they never read as a second row of tabs.
export const pillBarClasses = "flex flex-wrap gap-2";
export function pillClasses(active: boolean) {
  return `inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold ${
    active ? "border-brand bg-brand-tint text-brand-ink" : "border-line bg-surface text-ink-soft hover:text-ink"
  }`;
}

// The one way a tab or pill shows how many it holds.
export function Count({ value, active }: { value: number; active: boolean }) {
  return <span className={`rounded-tag px-2 text-caption font-semibold tabular-nums ${active ? "bg-brand-tint" : "bg-surface-subtle"}`}>{value}</span>;
}

export function LinkTabs({
  label,
  tabs
}: {
  label: string;
  tabs: Array<{ href: string; label: string; active: boolean; count?: number }>;
}) {
  return (
    <nav aria-label={label} className={tabBarClasses}>
      {tabs.map((tab) => (
        <Link aria-current={tab.active ? "page" : undefined} className={tabClasses(tab.active)} href={tab.href} key={tab.href}>
          <TabLabel>{tab.label}</TabLabel>
          {tab.count ? <Count active={tab.active} value={tab.count} /> : null}
        </Link>
      ))}
    </nav>
  );
}
