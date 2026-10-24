import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

// Also what a foreign or missing tenant resource renders: it must not hint at
// whether the thing exists.
export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full grid max-w-read gap-4 px-4 py-20 sm:px-6">
      <p className="text-sm font-semibold text-brand">404</p>
      <h1 className="text-3xl font-semibold text-ink">
        This page could not be found.
      </h1>
      <p className="text-ink-soft">
        The link may be out of date, or you may not have access to it.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link className={buttonClasses()} href="/">
          Browse events
        </Link>
        <Link className={buttonClasses({ variant: "secondary" })} href="/societies">
          Browse societies
        </Link>
      </div>
    </main>
  );
}
