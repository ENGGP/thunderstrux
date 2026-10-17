import Link from "next/link";

// URL-driven tabs: each tab is a link, so the view survives reloads and can be
// shared. The bar scrolls sideways on narrow screens instead of wrapping.
export const tabBarClasses =
  "flex overflow-x-auto shadow-[inset_0_-1px_0_var(--color-line)] sm:gap-1";

export function tabClasses(active: boolean) {
  return `inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-[3px] px-3 text-[15px] sm:px-4 ${
    active
      ? "border-brand font-semibold text-brand-ink"
      : "border-transparent font-medium text-ink-soft hover:text-ink"
  }`;
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
          {tab.label}
          {tab.count ? <span className="text-sm font-normal text-ink-muted">({tab.count})</span> : null}
        </Link>
      ))}
    </nav>
  );
}
