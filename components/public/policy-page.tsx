import type { ReactNode } from "react";

// The public Fees, Help and Privacy pages (T46, design round D1): a heading,
// a lead and plain sections in one readable column.
export function PolicyPage({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="bg-paper">
      <div className="mx-auto grid max-w-3xl gap-9 px-4 py-10 md:px-8 md:py-14">
        <header className="grid gap-2.5">
          <h1 className="font-display text-4xl font-semibold text-brand-ink md:text-5xl">{title}</h1>
          <p className="max-w-[60ch] text-lg text-ink-soft">{lead}</p>
        </header>
        {children}
      </div>
    </main>
  );
}

export function PolicySection({ title, children, highlight = false }: { title: string; children: ReactNode; highlight?: boolean }) {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return (
    <section aria-labelledby={id} className={`grid gap-2.5 text-ink-soft [&_p]:max-w-[66ch] ${highlight ? "rounded-card border border-line bg-surface p-6" : ""}`}>
      <h2 className="font-display text-2xl font-semibold text-ink" id={id}>{title}</h2>
      {children}
    </section>
  );
}

// The Thunderstrux contact, a deploy setting; the line is left out while it is unset.
export function platformSupportEmail() {
  const value = process.env.PLATFORM_SUPPORT_EMAIL?.trim();
  return value && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) ? value : null;
}
