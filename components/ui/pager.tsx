import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

// Previous and next links under a cursor-paged list (UI-019). A side shows only
// when there is a page that way; Next keeps the right edge on the first page.
export function Pager({
  label,
  previous,
  next,
  previousLabel = "Previous page",
  nextLabel = "Next page"
}: {
  label: string;
  previous?: string | null;
  next?: string | null;
  previousLabel?: string;
  nextLabel?: string;
}) {
  if (!previous && !next) return null;
  const link = buttonClasses({ variant: "secondary" });
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3">
      {previous ? (
        <Link className={link} href={previous}>
          <Icon className="rotate-180" name="chevronRight" />
          {previousLabel}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link className={link} href={next}>
          {nextLabel}
          <Icon name="chevronRight" />
        </Link>
      ) : null}
    </nav>
  );
}
