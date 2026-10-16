import Link from "next/link";
import type { ReactNode } from "react";
import { Button, buttonClasses } from "@/components/ui/button";

// A GET form: every filter lives in the URL, so a filtered list can be shared
// and Back works. Clear returns to the unfiltered page.
export function FilterBar({
  action,
  label,
  submitLabel = "Apply",
  className = "",
  children
}: {
  action: string;
  label: string;
  submitLabel?: string;
  // Grid columns for the fields; the actions take the last cell.
  className?: string;
  children: ReactNode;
}) {
  return (
    <form action={action} aria-label={label} className={`grid items-end gap-4 ${className}`} method="get" role="search">
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">{submitLabel}</Button>
        <Link className={buttonClasses({ variant: "tertiary" })} href={action}>
          Clear
        </Link>
      </div>
    </form>
  );
}
