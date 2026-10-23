import Link from "next/link";

// Lists only destinations that exist. Terms come when they have been legally
// drafted (LEGAL-001).
export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-ink-soft md:px-8">
        <p>
          <span className="font-display font-semibold text-brand-ink">
            Thunderstrux
          </span>{" "}
          Events and tools for student societies.
        </p>
        <nav aria-label="Footer" className="flex flex-wrap gap-5">
          <Link className="hover:text-brand" href="/">
            Events
          </Link>
          <Link className="hover:text-brand" href="/societies">
            Societies
          </Link>
          <Link className="hover:text-brand" href="/fees">
            Fees
          </Link>
          <Link className="hover:text-brand" href="/help">
            Help
          </Link>
          <Link className="hover:text-brand" href="/privacy">
            Privacy
          </Link>
        </nav>
      </div>
    </footer>
  );
}
