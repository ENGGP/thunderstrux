import Link from "next/link";
import type { ReactNode } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { FilterFold } from "@/components/ui/filter-fold";

// A GET form: every filter lives in the URL, so a filtered list can be shared
// and Back works. Clear returns to the unfiltered page.
export function FilterBar({
  action,
  label,
  submitLabel = "Apply",
  className = "",
  active,
  children
}: {
  action: string;
  label: string;
  submitLabel?: string;
  // Grid columns for the fields; the actions take the last cell.
  className?: string;
  // How many filters are on: given, the form folds behind a Filters toggle on phones.
  active?: number;
  children: ReactNode;
}) {
  const body = (
    <>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">{submitLabel}</Button>
        <Link className={buttonClasses({ variant: "tertiary" })} href={action}>
          Clear
        </Link>
      </div>
    </>
  );
  return (
    <form action={action} aria-label={label} className={`grid items-end gap-4 ${className}`} method="get" role="search">
      {active === undefined ? body : <FilterFold active={active}>{body}</FilterFold>}
    </form>
  );
}
